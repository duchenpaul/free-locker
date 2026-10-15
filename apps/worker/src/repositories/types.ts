export type EncryptionStatus = 'unknown' | 'not_encrypted' | 'encrypted';
export type FileLifecycleStatus =
  | 'uploading'
  | 'pending_scan'
  | 'active'
  | 'revoked'
  | 'expired'
  | 'exhausted'
  | 'cleanup_pending'
  | 'deleted'
  | 'failed';
export type ScanStatus = 'unscanned' | 'pending' | 'clean' | 'malicious' | 'failed';
