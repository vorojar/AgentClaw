---
name: imap-smtp-email
description: 收发邮件，查看收件箱、搜索邮件、发送带附件的邮件 | Read and send email via IMAP/SMTP with attachment support
---

Uses Python standard library (imaplib, smtplib, email). No pip install needed.

**Required environment variables** (must be set before use):
- `EMAIL_IMAP_HOST` — IMAP server (e.g. `imap.gmail.com`, `imap.qq.com`, `imap.163.com`)
- `EMAIL_SMTP_HOST` — SMTP server (e.g. `smtp.gmail.com`, `smtp.qq.com`, `smtp.163.com`)
- `EMAIL_USER` — Email address (e.g. `user@gmail.com`)
- `EMAIL_PASSWORD` — App password (NOT your login password; use app-specific password)
- `EMAIL_IMAP_PORT` (optional, default 993)
- `EMAIL_SMTP_PORT` (optional, default 465)

NEVER hardcode credentials in scripts — always read from `os.environ`.

## Step 0: Check environment variables (MANDATORY — always run this first)
**You MUST execute this check before doing anything else. Do NOT ask the user for credentials — they are pre-configured in environment variables.**
```python
# file_write: data/tmp/_script.py
import os
required = ['EMAIL_IMAP_HOST', 'EMAIL_SMTP_HOST', 'EMAIL_USER', 'EMAIL_PASSWORD']
missing = [v for v in required if not os.environ.get(v)]
if missing:
    print('MISSING: ' + ', '.join(missing))
else:
    print('OK: all set')
```
Then execute:
```json
{"command": "python data/tmp/_script.py", "timeout": 10000}
```

## List recent emails (inbox, last 10)

```python
# file_write: data/tmp/_script.py
import imaplib
import email
from email.header import decode_header
import os

host = os.environ["EMAIL_IMAP_HOST"]
port = int(os.environ.get("EMAIL_IMAP_PORT", "993"))
user = os.environ["EMAIL_USER"]
password = os.environ["EMAIL_PASSWORD"]

def decode_mime_header(s):
    if s is None:
        return ""
    parts = decode_header(s)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            result.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(data)
    return "".join(result)

mail = imaplib.IMAP4_SSL(host, port)
mail.login(user, password)
mail.select("INBOX")

status, data = mail.search(None, "ALL")
ids = data[0].split()
# Last 10 emails (most recent first)
recent_ids = ids[-10:][::-1]

for mid in recent_ids:
    status, msg_data = mail.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    subject = decode_mime_header(msg["Subject"])
    from_addr = decode_mime_header(msg["From"])
    date = msg["Date"]
    print(f"ID:{mid.decode()} | {date} | From: {from_addr} | Subject: {subject}")

mail.logout()
```

Then execute:
```json
{"command": "python data/tmp/_script.py", "timeout": 30000}
```

## Read a specific email (by ID)

```python
# file_write: data/tmp/_script.py
import imaplib
import email
from email.header import decode_header
import os

host = os.environ["EMAIL_IMAP_HOST"]
port = int(os.environ.get("EMAIL_IMAP_PORT", "993"))
user = os.environ["EMAIL_USER"]
password = os.environ["EMAIL_PASSWORD"]

def decode_mime_header(s):
    if s is None:
        return ""
    parts = decode_header(s)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            result.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(data)
    return "".join(result)

EMAIL_ID = b"123"  # <-- replace with actual email ID from listing

mail = imaplib.IMAP4_SSL(host, port)
mail.login(user, password)
mail.select("INBOX")

status, msg_data = mail.fetch(EMAIL_ID, "(RFC822)")
raw = msg_data[0][1]
msg = email.message_from_bytes(raw)

print(f"From: {decode_mime_header(msg['From'])}")
print(f"To: {decode_mime_header(msg['To'])}")
print(f"Subject: {decode_mime_header(msg['Subject'])}")
print(f"Date: {msg['Date']}")
print("---")

# Extract body
if msg.is_multipart():
    for part in msg.walk():
        content_type = part.get_content_type()
        disposition = str(part.get("Content-Disposition", ""))
        if content_type == "text/plain" and "attachment" not in disposition:
            charset = part.get_content_charset() or "utf-8"
            body = part.get_payload(decode=True).decode(charset, errors="replace")
            print(body)
            break
        elif content_type == "text/html" and "attachment" not in disposition:
            charset = part.get_content_charset() or "utf-8"
            body = part.get_payload(decode=True).decode(charset, errors="replace")
            print("[HTML content]")
            print(body[:2000])
            break
else:
    charset = msg.get_content_charset() or "utf-8"
    body = msg.get_payload(decode=True).decode(charset, errors="replace")
    print(body)

# List attachments
for part in msg.walk():
    if part.get_content_maintype() == "multipart":
        continue
    filename = part.get_filename()
    if filename:
        filename = decode_mime_header(filename)
        print(f"\n[Attachment] {filename} ({part.get_content_type()}, {len(part.get_payload(decode=True))} bytes)")

mail.logout()
```

## Download attachments from an email

```python
# file_write: data/tmp/_script.py
import imaplib
import email
from email.header import decode_header
import os

host = os.environ["EMAIL_IMAP_HOST"]
port = int(os.environ.get("EMAIL_IMAP_PORT", "993"))
user = os.environ["EMAIL_USER"]
password = os.environ["EMAIL_PASSWORD"]

def decode_mime_header(s):
    if s is None:
        return ""
    parts = decode_header(s)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            result.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(data)
    return "".join(result)

EMAIL_ID = b"123"  # <-- replace with actual email ID

mail = imaplib.IMAP4_SSL(host, port)
mail.login(user, password)
mail.select("INBOX")

status, msg_data = mail.fetch(EMAIL_ID, "(RFC822)")
msg = email.message_from_bytes(msg_data[0][1])

os.makedirs("data/tmp", exist_ok=True)
for part in msg.walk():
    if part.get_content_maintype() == "multipart":
        continue
    filename = part.get_filename()
    if filename:
        filename = decode_mime_header(filename)
        # Sanitize filename
        safe_name = "".join(c if c.isalnum() or c in ".-_ " else "_" for c in filename)
        filepath = f"data/tmp/{safe_name}"
        with open(filepath, "wb") as f:
            f.write(part.get_payload(decode=True))
        print(f"Saved: {filepath}")

mail.logout()
```

## Search emails

```python
# file_write: data/tmp/_script.py
import imaplib
import email
from email.header import decode_header
import os

host = os.environ["EMAIL_IMAP_HOST"]
port = int(os.environ.get("EMAIL_IMAP_PORT", "993"))
user = os.environ["EMAIL_USER"]
password = os.environ["EMAIL_PASSWORD"]

def decode_mime_header(s):
    if s is None:
        return ""
    parts = decode_header(s)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            result.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(data)
    return "".join(result)

mail = imaplib.IMAP4_SSL(host, port)
mail.login(user, password)
mail.select("INBOX")

# Search criteria examples:
# '(FROM "sender@example.com")'
# '(SUBJECT "meeting")'
# '(SINCE "01-Jan-2024")'
# '(UNSEEN)'
# '(FROM "boss" SINCE "01-Dec-2024")'

SEARCH_CRITERIA = '(SUBJECT "meeting")'  # <-- replace with actual criteria

status, data = mail.search(None, SEARCH_CRITERIA)
ids = data[0].split()
print(f"Found {len(ids)} email(s)")

for mid in ids[-20:][::-1]:  # last 20, most recent first
    status, msg_data = mail.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    subject = decode_mime_header(msg["Subject"])
    from_addr = decode_mime_header(msg["From"])
    date = msg["Date"]
    print(f"ID:{mid.decode()} | {date} | From: {from_addr} | Subject: {subject}")

mail.logout()
```

## Send a plain text email

```python
# file_write: data/tmp/_script.py
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

host = os.environ["EMAIL_SMTP_HOST"]
port = int(os.environ.get("EMAIL_SMTP_PORT", "465"))
user = os.environ["EMAIL_USER"]
password = os.environ["EMAIL_PASSWORD"]

TO = "recipient@example.com"       # <-- replace
SUBJECT = "Test Email"             # <-- replace
BODY = "Hello,\n\nThis is a test email.\n\nBest regards"  # <-- replace

msg = MIMEMultipart()
msg["From"] = user
msg["To"] = TO
msg["Subject"] = SUBJECT
msg.attach(MIMEText(BODY, "plain", "utf-8"))

with smtplib.SMTP_SSL(host, port) as server:
    server.login(user, password)
    server.sendmail(user, TO, msg.as_string())

print(f"OK: email sent to {TO}")
```

## Send an email with attachments

```python
# file_write: data/tmp/_script.py
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import os

host = os.environ["EMAIL_SMTP_HOST"]
port = int(os.environ.get("EMAIL_SMTP_PORT", "465"))
user = os.environ["EMAIL_USER"]
password = os.environ["EMAIL_PASSWORD"]

TO = "recipient@example.com"          # <-- replace
SUBJECT = "Report with Attachment"    # <-- replace
BODY = "请查收附件。"                    # <-- replace
ATTACHMENTS = ["data/tmp/report.pdf"] # <-- replace with actual file paths

msg = MIMEMultipart()
msg["From"] = user
msg["To"] = TO
msg["Subject"] = SUBJECT
msg.attach(MIMEText(BODY, "plain", "utf-8"))

for filepath in ATTACHMENTS:
    filename = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", filename))
    msg.attach(part)

with smtplib.SMTP_SSL(host, port) as server:
    server.login(user, password)
    server.sendmail(user, TO, msg.as_string())

print(f"OK: email with {len(ATTACHMENTS)} attachment(s) sent to {TO}")
```

## Send to multiple recipients

Change `TO` to a list and join for the header:
```python
TO = ["a@example.com", "b@example.com"]
msg["To"] = ", ".join(TO)
# ...
server.sendmail(user, TO, msg.as_string())
```

## Common IMAP search criteria
| Criteria | Meaning |
|----------|---------|
| `ALL` | All messages |
| `UNSEEN` | Unread messages |
| `SEEN` | Read messages |
| `FROM "addr"` | From specific sender |
| `SUBJECT "text"` | Subject contains text |
| `SINCE "01-Jan-2024"` | After date (DD-Mon-YYYY) |
| `BEFORE "01-Feb-2024"` | Before date |
| `FLAGGED` | Starred/flagged |

## Common IMAP/SMTP hosts
| Provider | IMAP Host | SMTP Host |
|----------|-----------|-----------|
| Gmail | imap.gmail.com | smtp.gmail.com |
| QQ Mail | imap.qq.com | smtp.qq.com |
| 163 Mail | imap.163.com | smtp.163.com |
| Outlook | outlook.office365.com | smtp.office365.com |

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- NEVER hardcode email credentials. Always read from `os.environ`.
- Before any operation, check that required env vars are set (Step 0).
- Gmail requires an "App Password" (not regular password). Guide the user if login fails.
- QQ Mail requires an authorization code from QQ Mail settings.
- Use `BODY.PEEK` instead of `BODY` when listing emails to avoid marking them as read.
- For sending: confirm recipient address and content with the user before sending.
- timeout 30000 for most operations. IMAP connections can be slow on first connect.
- Downloaded attachments go to `data/tmp/`. Use `send_file` to deliver them to the user.
