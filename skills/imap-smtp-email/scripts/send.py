"""Send email with optional attachments via SMTP."""
import argparse
import os
import smtplib
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--to", required=True, help="Recipient(s), comma-separated")
    p.add_argument("--subject", required=True)
    p.add_argument("--body", default="")
    p.add_argument("--cc", default="", help="CC recipient(s), comma-separated")
    p.add_argument("--attachments", nargs="*", default=[], help="File paths to attach")
    args = p.parse_args()

    host = os.environ["EMAIL_SMTP_HOST"]
    port = int(os.environ.get("EMAIL_SMTP_PORT", "465"))
    user = os.environ["EMAIL_USER"]
    password = os.environ["EMAIL_PASSWORD"]

    to_list = [a.strip() for a in args.to.split(",") if a.strip()]
    cc_list = [a.strip() for a in args.cc.split(",") if a.strip()] if args.cc else []

    msg = MIMEMultipart()
    msg["From"] = user
    msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    msg["Subject"] = args.subject
    msg.attach(MIMEText(args.body or "请查收。", "plain", "utf-8"))

    for filepath in args.attachments:
        filename = os.path.basename(filepath)
        with open(filepath, "rb") as f:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition", "attachment",
            filename=("utf-8", "", filename),
        )
        msg.attach(part)

    all_recipients = to_list + cc_list
    with smtplib.SMTP_SSL(host, port) as server:
        server.login(user, password)
        server.sendmail(user, all_recipients, msg.as_string())

    att_info = f" with {len(args.attachments)} attachment(s)" if args.attachments else ""
    print(f"OK: email{att_info} sent to {', '.join(all_recipients)}")


if __name__ == "__main__":
    main()
