# Deploy Mode: Infra

> Infrastructure as Code — Terraform, Pulumi, CloudFormation, Kubernetes manifests.

## IaC Tool Selection Decision Matrix

| Factor | Terraform | Pulumi | CloudFormation | K8s Manifests + Kustomize |
|--------|-----------|--------|---------------|---------------------------|
| Multi-cloud | Yes (primary strength) | Yes | AWS only | K8s only (any cloud) |
| Language | HCL (declarative) | TypeScript/Python/Go | YAML/JSON | YAML |
| State management | Remote backend required | Pulumi Cloud or self-managed | AWS-managed | etcd (cluster) |
| Learning curve | Medium | Low (if you know the language) | Medium | Low-Medium |
| Ecosystem | Largest provider ecosystem | Growing, can use TF providers | AWS-native deep integration | Helm charts, operators |
| Best for | Multi-cloud, large infra | Dev teams preferring real code | AWS-only shops | K8s-native workloads |

**Decision rule**: Default to Terraform for cloud infra. Use Pulumi if team prefers general-purpose language. Use K8s manifests for cluster-internal resources. Use CloudFormation only for deep AWS-native features not in Terraform provider.

## Workflow

1. **Identify provider** — AWS / GCP / Azure / multi-cloud
2. **Select IaC tool** — use decision matrix above
3. **Design module structure** — separate modules for networking, compute, storage, databases
4. **Define resources** — compute, storage, networking, databases, IAM
5. **State management** — remote backend with locking (S3+DynamoDB, GCS, Terraform Cloud)
6. **Environment separation** — dev / staging / production using workspaces or directory structure
7. **Security** — IAM least privilege, network policies, encryption at rest/transit
8. **Cost estimation** — run Infracost or cloud pricing before apply
9. **Apply with review** — `plan` → human review → `apply` (never blind apply)

## Terraform Best Practices

### Project Structure
```
infra/
  modules/
    networking/     # VPC, subnets, security groups
    compute/        # EC2, ECS, Lambda
    database/       # RDS, DynamoDB, ElastiCache
    monitoring/     # CloudWatch, alarms
  environments/
    dev/
      main.tf       # Uses modules with dev params
      terraform.tfvars
    staging/
      main.tf
    production/
      main.tf
  backend.tf        # Remote state configuration
  versions.tf       # Provider version constraints
```

### State Management Rules

| Rule | Why |
|------|-----|
| Always remote backend | Local state = single point of failure, no collaboration |
| Enable state locking | Prevent concurrent modifications (DynamoDB for S3, built-in for TF Cloud) |
| Encrypt state at rest | State contains secrets (RDS passwords, API keys) |
| Never edit state manually | Use `terraform state mv`, `terraform import`, `terraform state rm` |
| Separate state per environment | Blast radius: staging state corruption doesn't affect production |

### Plan/Apply Protocol

```bash
# Always plan first
terraform plan -out=tfplan

# Review plan output carefully — check:
# 1. No unexpected destroys (especially databases, persistent storage)
# 2. No unexpected recreates (force replacement triggers)
# 3. Resource count matches expectations
# 4. No security group / IAM changes you didn't intend

# Apply only the reviewed plan
terraform apply tfplan

# For targeted changes (use sparingly)
terraform plan -target=module.{name}
```

**HARD BLOCK**: Never `terraform apply` without reviewing `terraform plan` output.

### Module Versioning

```hcl
# Pin module versions — never use unversioned source
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.5.0"  # Pin to exact version
}

# Internal modules — use git tags
module "app" {
  source = "git::https://github.com/org/modules.git//app?ref=v1.2.0"
}
```

## Pulumi Patterns

```typescript
// Type-safe infrastructure with Pulumi + TypeScript
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const env = pulumi.getStack(); // dev, staging, production

// Stack references for cross-stack dependencies
const networkStack = new pulumi.StackReference(`org/network/${env}`);
const vpcId = networkStack.getOutput("vpcId");
```

## K8s Manifest Best Practices

- Use Kustomize for environment overlays (base + overlays/dev, overlays/prod)
- Apply with `kubectl diff` before `kubectl apply` (deployment simulation)
- Use resource quotas and limit ranges per namespace
- Network policies default-deny, explicit allow
- See [k8s-patterns.md](k8s-patterns.md) for deployment strategies

## Cost Estimation

```bash
# Infracost — estimate cost before apply
infracost breakdown --path=. --format=table
infracost diff --path=. --compare-to=infracost-base.json

# AWS Cost Calculator CLI
# GCP Pricing Calculator
# Azure Pricing Calculator
```

## Exit Criteria

- [ ] `terraform plan` (or equivalent) shows only expected changes
- [ ] State stored remotely with locking enabled
- [ ] State encrypted at rest
- [ ] Modules versioned (no unversioned sources)
- [ ] Environments separated (dev/staging/prod)
- [ ] IAM follows least privilege principle
- [ ] Network policies restrict unnecessary access
- [ ] Encryption at rest/transit for data stores
- [ ] Cost estimate reviewed before apply
- [ ] No manual changes outside IaC (drift prevention)

## Tools

- `serena`: create_text_file, replace_content, execute_shell_command
- `context7`: Terraform/Pulumi docs, K8s API reference, cloud provider docs
- See [k8s-patterns.md](k8s-patterns.md)
