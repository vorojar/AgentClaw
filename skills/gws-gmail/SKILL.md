---
name: gws-gmail
description: Gmail邮件管理——搜索、阅读、发送、管理邮件 | Gmail via gws CLI (search, read, send, manage emails)
---

Requires: `gws` CLI installed and authenticated (`gws auth login`).

## Command syntax

```
gws gmail <resource> <method> --params '{"key":"val"}' --json '{"key":"val"}'
```

userId is always `"me"` for the authenticated user.

## List recent messages

```json
{"command": "gws gmail users messages list --params '{\"userId\":\"me\",\"maxResults\":10}'", "timeout": 30000}
```

## Search messages

```json
{"command": "gws gmail users messages list --params '{\"userId\":\"me\",\"q\":\"from:alice@example.com subject:report\",\"maxResults\":10}'", "timeout": 30000}
```

Gmail search syntax: `from:`, `to:`, `subject:`, `after:2026/03/01`, `before:`, `is:unread`, `has:attachment`, `label:`, `in:sent`.

## Read a message

```json
{"command": "gws gmail users messages get --params '{\"userId\":\"me\",\"id\":\"MESSAGE_ID\",\"format\":\"full\"}'", "timeout": 30000}
```

Formats: `full` (headers + body), `metadata` (headers only), `minimal` (IDs only).

## Send email

Build a base64url-encoded RFC 2822 message and use `users.messages.send`.

**IMPORTANT**: If the Subject contains non-ASCII characters (Chinese, Japanese, etc.), you MUST encode it using RFC 2047 MIME encoded-word syntax: `=?UTF-8?B?<base64>?=`. Use `echo -n 'subject text' | base64 -w 0` to get the base64, then wrap it as `=?UTF-8?B?...?=`. ASCII-only subjects can be used as-is.

Example (ASCII subject):
```json
{"command": "echo -e 'From: me\\nTo: alice@example.com\\nSubject: Hello\\nContent-Type: text/plain; charset=utf-8\\n\\nHello Alice!' | base64 -w 0 | tr '+/' '-_' | tr -d '=' | xargs -I {} gws gmail users messages send --params '{\"userId\":\"me\"}' --json '{\"raw\":\"{}\"}'", "timeout": 30000}
```

Example (non-ASCII subject):
```json
{"command": "SUBJ=$(echo -n '报告标题' | base64 -w 0) && echo -e \"From: me\\nTo: alice@example.com\\nSubject: =?UTF-8?B?${SUBJ}?=\\nContent-Type: text/plain; charset=utf-8\\n\\nHello!\" | base64 -w 0 | tr '+/' '-_' | tr -d '=' | xargs -I {} gws gmail users messages send --params '{\"userId\":\"me\"}' --json '{\"raw\":\"{}\"}'", "timeout": 30000}
```

## List labels

```json
{"command": "gws gmail users labels list --params '{\"userId\":\"me\"}'", "timeout": 30000}
```

## Modify labels (mark read/unread, archive)

```json
{"command": "gws gmail users messages modify --params '{\"userId\":\"me\",\"id\":\"MESSAGE_ID\"}' --json '{\"removeLabelIds\":[\"UNREAD\"]}'", "timeout": 30000}
```

Archive (remove INBOX label):
```json
{"command": "gws gmail users messages modify --params '{\"userId\":\"me\",\"id\":\"MESSAGE_ID\"}' --json '{\"removeLabelIds\":[\"INBOX\"]}'", "timeout": 30000}
```

## Trash / delete

```json
{"command": "gws gmail users messages trash --params '{\"userId\":\"me\",\"id\":\"MESSAGE_ID\"}'", "timeout": 30000}
```

## Discover parameters

```json
{"command": "gws schema gmail.users.messages.list", "timeout": 15000}
```

## Rules
- userId is always `"me"`.
- List messages returns only IDs and threadIds. Use `get` with `format: full` to read content.
- Sending email requires base64url-encoded RFC 2822 format in the `raw` field.
- Use Gmail search syntax in the `q` parameter for filtering.
- For attachments: use `users messages attachments get` after reading the message to get attachment metadata.
