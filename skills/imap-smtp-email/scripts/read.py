"""Read a specific email by ID."""

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
    p.add_argument("--id", required=True, help="Email ID from list command")
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
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)

    print(f"From: {decode_mime(msg['From'])}")
    print(f"To: {decode_mime(msg['To'])}")
    print(f"Subject: {decode_mime(msg['Subject'])}")
    print(f"Date: {msg['Date']}")
    print("---")

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in disp:
                charset = part.get_content_charset() or "utf-8"
                print(part.get_payload(decode=True).decode(charset, errors="replace"))
                break
            elif ct == "text/html" and "attachment" not in disp:
                charset = part.get_content_charset() or "utf-8"
                print("[HTML]")
                print(
                    part.get_payload(decode=True).decode(charset, errors="replace")[
                        :2000
                    ]
                )
                break
    else:
        charset = msg.get_content_charset() or "utf-8"
        print(msg.get_payload(decode=True).decode(charset, errors="replace"))

    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        fn = part.get_filename()
        if fn:
            fn = decode_mime(fn)
            size = len(part.get_payload(decode=True))
            print(f"\n[Attachment] {fn} ({part.get_content_type()}, {size} bytes)")

    mail.logout()


if __name__ == "__main__":
    main()
