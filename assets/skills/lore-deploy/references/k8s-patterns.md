# Kubernetes Patterns Quick Reference

## Deployment Strategies

| Strategy | How |
|----------|-----|
| Rolling | `maxSurge: 25%, maxUnavailable: 25%` |
| Blue-Green | Two Deployments (blue/green labels), Service selector switches `version:` label |
| Canary | Stable (9 replicas) + Canary (1 replica), shared Service selector on `app:` only |

## Service Types

| Type | Use Case | Key Config |
|------|----------|------------|
| ClusterIP | Internal | Default |
| LoadBalancer | External | `service.beta.kubernetes.io/aws-load-balancer-type: nlb` |
| NodePort | Debug/legacy | Port range 30000-32767 |
| Headless | StatefulSet | `clusterIP: None` |

## Ingress

```yaml
# TLS with cert-manager:
annotations:
  cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls: [{ hosts: [app.example.com], secretName: app-tls }]
```

Path-based routing: multiple `paths` entries under same host.

## Probes

| Probe | Purpose | Typical Config |
|-------|---------|---------------|
| liveness | Restart unhealthy | initialDelay:30s, period:10s, failure:3 |
| readiness | Traffic routing | initialDelay:5s, period:5s, failure:3 |
| startup | Slow-start apps | failureThreshold:30, period:10s (=300s budget) |

Probe types: `httpGet`, `tcpSocket`, `exec`, `grpc`

## Resource Management

```yaml
# HPA: minReplicas:2, maxReplicas:10, cpu:70%, memory:80%
# Scale-down: stabilization 300s, 10%/60s
# Scale-up: stabilization 0s, 100%/15s
# PDB: minAvailable:2 or maxUnavailable:1
```

## Security Checklist

- [ ] `runAsNonRoot: true`, `runAsUser: 1000`
- [ ] `readOnlyRootFilesystem: true`
- [ ] `allowPrivilegeEscalation: false`
- [ ] `capabilities: { drop: [ALL] }`
- [ ] NetworkPolicy: restrict ingress/egress by pod label
- [ ] `automountServiceAccountToken: false` if SA not needed

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Pod not starting | `describe pod` → image pull errors, resource constraints, events |
| Pod crashing | `logs --previous` → app errors, OOMKilled; check liveness config |
| Service unreachable | `get endpoints` → selector/label mismatch; port-forward to pod directly |
| Ingress broken | `describe ingress` → ingress class, TLS cert status |
