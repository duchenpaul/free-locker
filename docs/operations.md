# Operations

## Cleanup

The Cron trigger runs every 15 minutes. Each pass is bounded to ten file records so it stays within Free Worker CPU limits.

2. Expired, exhausted, revoked, and failed files are claimed with `cleanup_pending`.
3. The R2 object is deleted.
4. D1 records become `deleted`; deletion failures are recorded for retry.
5. Expired grants and rate-limit windows are pruned.

Logical access checks happen on every download and do not wait for Cron. Scheduled storage deletion is asynchronous and should not be represented as exact-to-the-second erasure.

## Abuse handling

`POST /api/v1/reports` collects a public ID, optional contact address, and a reason. It cannot delete content. An operator verifies a report, then revokes a transfer with the protected admin endpoint or a controlled D1 operation. Revocation blocks access immediately; Cron removes the object later.

Keep abuse reports and minimal audit data only for the configured period needed to resolve reports. Do not add raw IPs, upload bodies, signed URLs, R2 credentials, or bearer capabilities to logs.

## Quotas and monitoring

- Watch Worker request count, CPU errors, and `1027` quota errors.
- Watch R2 storage, Class A writes, and Class B reads.
- Watch D1 reads/writes, storage, overloaded errors, and query duration.
- Alert operationally before free allowances are exhausted; a free plan is not unlimited capacity.
- Use configured per-IP request windows and active-share limits to slow abuse. IPs behind NAT or IPv6 privacy rotation are imperfect controls.

## Incident response

1. Revoke the offending public ID.
2. Preserve only minimal report/audit data needed for review.
3. Check cleanup status and retry failed R2 deletion.
4. Rotate `ADMIN_TOKEN`, `IP_HASH_SALT`, and R2 signing credentials if exposure is suspected.
5. Inspect Workers/D1/R2 logs without copying signed URLs or secrets into ticket systems.
