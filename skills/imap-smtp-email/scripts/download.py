"""Download attachments from a specific email."""

import argparse
import imaplib
import email
from email.header import decode_header
import os


def decode_mime(s):
    if s is None:
        return ""
    parts = decode_header(s)
    out = []
    for data, charset in parts:
        if isinstance(data, bytes):
            out.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            out.append(data)
    return "".join(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True, help="Email ID")
    p.add_argument("--output-dir", default="data/tmp", help="Save directory")
    p.add_argument("--folder", default="INBOX")
    args = p.parse_args()

    host = os.environ["EMAIL_IMAP_HOST"]
    port = int(os.environ.get("EMAIL_IMAP_PORT", "993"))
    user = os.environ["EMAIL_USER"]
    password = os.environ["EMAIL_PASSWORD"]

    mail = imaplib.IMAP4_SSL(host, port)
    mail.login(user, password)
    mail.select(args.folder)

    _, msg_data = mail.fetch(args.id.encode(), "(RFC822)")
    msg = email.message_from_bytes(msg_data[0][1])

    os.makedirs(args.output_dir, exist_ok=True)
    count = 0
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        fn = part.get_filename()
        if fn:
            fn = decode_mime(fn)
            safe = "".join(c if c.isalnum() or c in ".-_ " else "_" for c in fn)
            path = os.path.join(args.output_dir, safe)
            with open(path, "wb") as f:
                f.write(part.get_payload(decode=True))
            print(f"Saved: {path}")
            count += 1

    if count == 0:
        print("No attachments found.")
    mail.logout()


if __name__ == "__main__":
    main()
