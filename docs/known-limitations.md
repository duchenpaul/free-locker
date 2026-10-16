# Known limitations

- Cloudflare Free zones cap request bodies at 100 MB. The Worker direct path uses a configurable 95 MiB maximum, not the reference service's 10 GB claim.
- The app is not end-to-end encrypted and is not backup storage.
- The default deployment does not scan for malware.
- Cleanup blocks access at expiry immediately, but Cron/R2 deletion is asynchronous and may retry later.
- This MVP does not provide accounts, permanent share management, public bucket URLs, or a paid Cloudflare Rate Limiting product.
