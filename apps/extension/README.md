# Repost Radar for Chrome

Right-click any image and choose **Check against Repost Radar** to see whether it is one of your originals. The toolbar popup lists your recently approved matches, with **Copy notice** and a link to the platform's copyright page, so filing stays one paste away and always manual.

## Install (unpacked)

1. In Repost Radar, open **Settings › Browser extension tokens** and create a token.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick this `apps/extension` folder.
3. Open the extension's **Options**, keep the API URL (`http://localhost:3000/api`) or enter yours, paste the token, then **Save and test**.

## What it can do

- **Check an image**: the image is downloaded by the extension, sent to `POST /checks`, compared with your originals by the worker, and deleted from the server straight away. Nothing about it is stored.
- **Read matches and notices** for the popup.

The token cannot approve, dismiss, edit templates or create more tokens; the API refuses those (403). Revoke it in Settings at any time.

## Permissions

| Permission | Why |
| --- | --- |
| `contextMenus` | The right-click entry on images |
| `storage` | The API URL and token, kept in this browser only |
| `localhost` / `127.0.0.1` | Talk to your Repost Radar |
| `i.redd.it`, `preview.redd.it`, `external-preview.redd.it`, `cdn.bsky.app` | Read images on the platforms Repost Radar watches |
| Other sites (optional) | Asked for one site at a time, only when you check an image hosted there |
