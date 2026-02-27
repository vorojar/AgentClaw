---
name: imap-smtp-email
description: 收发邮件，查看收件箱、搜索邮件、发送带附件的邮件 | Read and send email via IMAP/SMTP with attachment support
---

Environment variables are pre-configured. Just run the commands below.

## Send email (with optional attachments and CC)
```
{"command": "python skills/imap-smtp-email/scripts/send.py --to 'addr@example.com' --subject 'Subject' --body 'Body text' --attachments 'file1.pdf' 'file2.xlsx' --cc 'cc@example.com'", "timeout": 30000}
```

## List recent emails
```
{"command": "python skills/imap-smtp-email/scripts/list.py --count 10", "timeout": 30000}
```

## Read email by ID
```
{"command": "python skills/imap-smtp-email/scripts/read.py --id 123", "timeout": 30000}
```

## Search emails
```
{"command": "python skills/imap-smtp-email/scripts/search.py --criteria 'FROM \"test@example.com\"'", "timeout": 30000}
```
Criteria: `FROM "addr"`, `SUBJECT "text"`, `SINCE "01-Jan-2024"`, `UNSEEN`, `ALL`

## Download attachments
```
{"command": "python skills/imap-smtp-email/scripts/download.py --id 123 --output-dir data/tmp", "timeout": 30000, "auto_send": true}
```

## Rules
- ALWAYS use bash shell, never PowerShell.
- NEVER hardcode credentials — scripts read from `os.environ` automatically.
- Use actual file paths for --attachments (not URLs).
