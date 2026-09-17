# GBV Case Management System

Production-style starter monorepo for consent-aware GBV case reporting, upward referrals, duplicate review, service tracking, outcomes, audit logs, JWT authentication, PostgreSQL, and a React frontend.

## Run locally

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:5173. API docs: http://localhost:8000/docs.

The first registered account is not automatically privileged. Use the registration endpoint for development, then provision roles through a protected administration workflow before deployment.

## Important safeguarding requirements

This is a starter implementation, not a certified safeguarding product. Before handling real survivor data, add professional identity management/OIDC, MFA, field-level encryption, tenant/geographic isolation, secure secrets management, backups, retention/deletion policies, incident response, rate limiting, security testing, and survivor-centered consent workflows. Do not place names, phone numbers, or exact addresses in `survivor_code` or public analytics. Possible duplicates require human review and are never merged automatically.
