# Tool Reference: Self-Hosted Shared Postgres (myserver / `postgres` container)

**Purpose**: A single self-hosted Postgres instance that hosts **one database per project** (logical isolation). Replaces Neon for projects where Neon/Supabase free-tier limits (project count, storage) are too tight. One shared process = minimal memory; each project gets its own `DATABASE` + `ROLE`.

**When to use**: New project DB provisioning when you want to bypass managed-DB quotas and keep everything on your own VPS. For projects that need Neon's branching/serverless, keep using Neon (see `neonctl.md`).

## Instance facts (SSOT is `config.json` → `selfhosted_pg`; verified live 2026-07-12)

| Field | Value |
|---|---|
| Server SSH alias | `myserver` (root@62.146.233.249) |
| Container | `postgres` (postgres:16, `--restart always`) — NOT named `pg-shared` |
| Superuser | `danielzz` (NOT `postgres`) |
| Public endpoint | `62.146.233.249:25432` (bound `0.0.0.0`, security group open) |
| TLS | ON since 2026-07-12. Self-signed, `CN/SAN=IP:62.146.233.249`, valid to 2036. Cert/key live at `/var/lib/postgresql/data/server.{crt,key}` inside the data volume. Connect with `sslmode=require` |
| Data volume | `postgres_data` (persistent) |
| Backups | `pg-backup` sidecar container (postgres:16, `--restart unless-stopped`) on network `pg-net`; daily `pg_dump | gzip` of every project DB → `srv_backups:/daily/`, 7-day retention. Script: `srv_backups:/pg-backup.sh` |
| Admin password | container env `POSTGRES_PASSWORD` only. NOT stored in config.json. |

### Get the admin password (never hardcode it)
```bash
ssh -T myserver "docker exec postgres printenv POSTGRES_PASSWORD"
```

### Current databases (2026-07-12)
| DB | Role | Notes |
|---|---|---|
| `babyai` | `babyai` | used by Coolify app `babyai-worker` |
| `productivity_hub` | `productivity_hub_user` | role created 2026-07-12; password in user's client env |

(`deficoco` and `openclaw_productivity` were removed 2026-07-11; final dumps kept in `srv_backups`.)

## ⚠️ CRITICAL environment gotchas (learned the hard way 2026-07-11)

`ssh myserver` does **NOT** drop you on the host — it lands in an **ephemeral management container** that shares the host PID ns + mounts the host docker.sock, but has its **own isolated + non-persistent filesystem**. Consequences:

1. **Always use `ssh -T`** — a PTY gets allocated otherwise and output is duplicated/garbled/**fabricated** (fake sizes, fake "OK"). Filter noise: `... 2>&1 | grep -v 'locale\|manpath\|LC_ALL' | awk '!seen[$0]++'`. ⚠️ the dedup filter also swallows legitimate repeated lines (e.g. two identical `DROP ROLE` results, or role names that already appeared as DB names) — interpret "missing" lines accordingly.
2. **Files written to the session container (`/root`, `/tmp`) vanish on next connection.** Only Docker volumes persist. Never store backups/scripts in `/root`.
3. **Cross-container pipe backups silently FAIL**: `docker exec X pg_dump | docker run -i ... cat > /vol/file` produces empty/dir garbage in this env. **Do NOT use.**
4. **Container-to-container `docker cp` is not supported.** Two-hop instead: `docker cp <src>:/f /tmp/f && docker cp /tmp/f <helper>:/vol/f` within one ssh session.
5. **Verify by EXIT CODE, not stdout** (stdout is PTY-poisoned): `docker run --rm -v srv_backups:/b postgres:16 gzip -t /b/daily/x.sql.gz; echo $?` — `0` = valid.
6. `docker`/`docker exec` commands ARE real (they hit the host dockerd via the mounted socket), so container state changes persist.
7. **To pass scripts to the server**, base64-encode locally and decode into a volume: `B64=$(base64 < script.sh); ssh -T myserver "docker run --rm -v vol:/v postgres:16 sh -c 'echo $B64 | base64 -d > /v/script.sh'"`.

## Open a new project DB (the core op)

```bash
PROJ=myapp                                        # project name (db + role prefix)
DPW=$(openssl rand -hex 16)                        # generate locally so we know it
ssh -T myserver "docker exec postgres psql -U danielzz -v ON_ERROR_STOP=1 \
  -c \"CREATE DATABASE $PROJ\" \
  -c \"CREATE ROLE ${PROJ}_user LOGIN PASSWORD '$DPW'\" \
  -c \"REVOKE ALL ON DATABASE $PROJ FROM PUBLIC\" \
  -c \"GRANT ALL PRIVILEGES ON DATABASE $PROJ TO ${PROJ}_user\" \
  -c \"ALTER DATABASE $PROJ OWNER TO ${PROJ}_user\""
# Connection string (public + TLS):
echo "postgresql://${PROJ}_user:$DPW@62.146.233.249:25432/$PROJ?sslmode=require"
# Store $DPW in the project's Vercel env (DATABASE_URL), never in config.json.
# Then add the DB name to the backup loop: edit srv_backups:/pg-backup.sh (the `for db in ...` line)
# and `docker restart pg-backup`.
```

Isolation guarantee: `REVOKE ... FROM PUBLIC` means `${PROJ}_user` can only reach its own DB. Verify: connecting that role to another DB must fail with `User does not have CONNECT privilege`.

## List / delete project DBs

```bash
# list all project databases
ssh -T myserver "docker exec postgres psql -U danielzz -tAc \"SELECT datname FROM pg_database WHERE datistemplate=false\""

# delete a project (backup first! then drop db + role, remove from backup script)
ssh -T myserver "docker exec postgres psql -U danielzz \
  -c \"DROP DATABASE IF EXISTS $PROJ\" -c \"DROP ROLE IF EXISTS ${PROJ}_user\""
```

## Backups

Automatic: `pg-backup` sidecar dumps every project DB daily to `srv_backups:/daily/`, keeps 7 days, gzip-verified. Check health:

```bash
ssh -T myserver "docker logs pg-backup 2>&1 | tail -5
docker run --rm -v srv_backups:/b postgres:16 ls -l /b/daily/"
```

Manual one-off dump (reliable pattern):

```bash
ssh -T myserver "docker exec postgres sh -c 'pg_dump -U danielzz $PROJ > /tmp/$PROJ.sql'
docker cp postgres:/tmp/$PROJ.sql /tmp/$PROJ.sql
docker rm -f bh 2>/dev/null; docker run -d --name bh -v srv_backups:/b postgres:16 sleep 120 >/dev/null
docker cp /tmp/$PROJ.sql bh:/b/$PROJ-manual.sql; docker rm -f bh"
```

## Local connection options

- **Public direct** (25432/tcp is open in the provider security group): `psql "postgresql://user:pw@62.146.233.249:25432/db?sslmode=require"`
- **SSH tunnel** (most secure): `ssh -L 25432:localhost:25432 myserver` then connect `localhost:25432`.

Note: the security group is managed at the **VPS provider**, not on the box (no ufw/nftables; docker self-manages iptables).

## Coexists with

Coolify (80/443 traefik) + its `coolify-db` (postgres:15, platform metadata — **off-limits**), `sub2api-postgres` (postgres:18, internal to sub2api — unrelated), n8n, redis. Project DBs live only in the `postgres` container.
