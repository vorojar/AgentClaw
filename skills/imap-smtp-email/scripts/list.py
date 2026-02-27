"""List recent emails from IMAP inbox."""

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
    p.add_argument("--count", type=int, default=10, help="Number of recent emails")
    p.add_argument("--folder", default="INBOX")
    args = p.parse_args()

    host = os.environ["EMAIL_IMAP_HOST"]
    port = int(os.environ.get("EMAIL_IMAP_PORT", "993"))
    user = os.environ["EMAIL_USER"]
    password = os.environ["EMAIL_PASSWORD"]

    mail = imaplib.IMAP4_SSL(host, port)
    mail.login(user, password)
    mail.select(args.folder)

    _, data = mail.search(None, "ALL")
    ids = data[0].split()
    recent = ids[-args.count :][::-1]

    for mid in recent:
        _, msg_data = mail.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)
        subj = decode_mime(msg["Subject"])
        frm = decode_mime(msg["From"])
        date = msg["Date"]
        print(f"ID:{mid.decode()} | {date} | From: {frm} | Subject: {subj}")

    mail.logout()


if __name__ == "__main__":
    main()
