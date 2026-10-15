# Known limitations

- Cloudflare Free zones cap request bodies at 100 MB. The Worker direct path uses a configurable 95 MiB maximum, not the reference service's 10 GB claim.
- Large uploads need R2 signing credentials and a real-bucket compatibility test for presigned `UploadPart` URLs. Without them, the API returns `MULTIPART_UNAVAILABLE`.
- The included direct multipart client uploads parts sequentially. It is reliable and bounded, but parallelized parts are a later performance enhancement.
- The app is not end-to-end encrypted and is not backup storage.
- The default deployment does not scan for malware.
- Cleanup blocks access at expiry immediately, but Cron/R2 deletion is asynchronous and may retry later.
- This MVP does not provide accounts, permanent share management, public bucket URLs, or a paid Cloudflare Rate Limiting product.
- Browser multipart uploads require a deployed R2 CORS policy based on `config/r2-cors.example.json`; command-line clients do not need CORS.
