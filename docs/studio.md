# Studio workspace

Studio is the default visual layout for Hermes Voice Assistant by Devsdroid.com. It places the voice core beside the conversation, with sessions and actual worker/approval controls in adjacent panels. It is a frontend-only revision, not a change to the agent runtime.

## Everyday controls

- Start the microphone explicitly. The animated core alone never means the microphone is on.
- Read the voice status: standby, listening, thinking and speaking follow actual foreground activity.
- **Interrupt** retains its existing behavior: stop foreground chat and audio, not background workers. Cancel workers on their own cards.
- **Hide visual** removes the decorative core when you want more reading space.
- Core and Daylight remain available. Your operating system's reduced-motion preference freezes the Studio geometry while status and controls continue to update.
- Session management, setup, provider settings, voice previews and approval decisions remain the existing real controls. The illustrative artifact card from the design lab is not shipped as a pretend file service.

## Switch back without losing work

Use the header's layout control to switch to **Classic**. The preference stays in this browser, separate from provider settings and session history. Switching layout does not restart the service, send a message, stop a worker, activate the microphone or replace the conversation.

Classic retains the earlier layout and ring renderer. Studio uses a lightweight projected 3D point cloud and orbital geometry drawn in Canvas2D, not a heavyweight WebGL scene or a new rendering dependency. Input and playback amplitude come from the existing measured audio signals, not fabricated progress.

The design lab in `docs/design/ui-lab.html` remains a clearly labelled, disconnected prototype. It is not the application launch page.

## Engineering boundaries

- `studio.css` scopes the new layout and surface treatment to Studio.
- `studio.mjs` owns only browser presentation preferences and layout controls.
- `orb-geometry.mjs` draws projected 3D geometry. It has no microphone, network, provider or persistence access.
- `orb.mjs` keeps existing audio analysis and state hooks; the Classic drawing path remains available.
- There is no new backend API, schema migration, model/provider default, credential field or automatic speech action.

This is still a local alpha. A responsive browser layout does not imply remote/mobile network access is enabled. Arbitrary artifact preview/download, full-duplex voice and public-release readiness remain separate work.
