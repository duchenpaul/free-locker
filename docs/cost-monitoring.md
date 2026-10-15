# Cost monitoring

The intended budget is zero only while account-wide free allowances are not exceeded. Configure dashboard checks for Workers requests/CPU, D1 reads/writes/storage, and R2 storage/Class A/Class B operations.

Conservative defaults reduce accidental spend:

- 95 MiB direct upload cap
- 24-hour retention
- five download authorizations
- 15-minute cleanup schedule
- per-IP hourly upload quota
- private R2 bucket with no public download path

Set an operational review threshold below every free allowance. When an allowance is near exhaustion, lower rate limits, disable public uploads, or require a planned billing decision rather than allowing uncontrolled use.
