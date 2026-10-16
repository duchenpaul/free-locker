# Cloudflare Free-tier feasibility

The MVP is feasible on Cloudflare Free with conservative limits, but not as an unlimited storage service.

| Capability              | Feasible approach             | Constraint                                                                                   |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Browser and curl upload | Worker streams to private R2  | Free zone request body limit is 100 MB; app defaults to 95 MiB                               |
| Large upload            | Rejected with 413             | Per-file limit is enforced server-side; no multipart path                                    |
| Direct download         | Worker streams R2 response    | Response size is not capped by Workers request-body limits, but requests count against quota |
| Metadata                | D1                            | Free database storage/read/write quotas are finite                                           |
| Expiry cleanup          | Cron Trigger                  | Asynchronous; use logical authorization checks too                                           |
| Malware scanning        | Optional external integration | Not included in a zero-cost default deployment                                               |

Current planning assumptions from Cloudflare documentation should be revalidated at deployment: Workers Free request/CPU quotas, D1 Free storage/query quotas, R2 storage/operation quotas, Static Assets behavior, Cron limits, and the account's zone upload maximum. Never silently enable a paid rate-limiting, scanning, or storage service.
