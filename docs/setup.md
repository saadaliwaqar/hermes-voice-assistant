# First-run setup

The setup wizard guides configuration of this dashboard. It does not install Hermes, modify upstream Hermes settings, create provider accounts or silently download models. It is safe to dismiss and reopen from **Setup**.

## Checks and configuration

1. Review local runtime and optional speech dependency checks. A missing Hermes runtime means the dashboard's history/settings UI can work, but model conversations cannot. Optional speech dependencies are not required for text-only use.
2. Choose the provider and default/worker model. An optional conversation model can be configured separately. **Test connection** is an explicit model request and may consume provider credits. Merely opening Setup does not run inference.
3. Choose a voice provider or keep **None**. Cloud speech needs the provider's own access; keys stay in the server environment. Use the voice picker and fixed-sample preview to test speaker playback.
4. Test microphone access explicitly. Allow browser permission only when ready. The test must release capture when you leave it; a successful browser microphone test is not proof that transcription/model/voice dependencies all work.
5. Save and finish when satisfied. Completion is a local onboarding flag, not certification that all providers, hardware and models work. Missing optional components do not prevent finishing a text-only setup.

## Authentication and installation boundaries

Configure your model credentials using the normal [Hermes setup](https://hermes-agent.nousresearch.com/docs/) outside this dashboard. The [Python embedding guide](https://hermes-agent.nousresearch.com/docs/guides/python-library) documents the supported runtime environment. For voice credentials and offline model installation, see [voice providers](voice-providers.md). Neither wizard fields nor local browser storage accept secret API keys.

A source checkout's existence is not sufficient: the **Python interpreter running the dashboard** must be able to import the required Hermes runtime. See [installation](installation.md) for the environment requirement. Runtime availability checks and successful authenticated inference are separate checks; only the explicit connection test can establish the latter at that moment.

## Privacy

The connection test sends a fixed, short tool-free prompt to the selected model provider, not your existing conversation history. The dashboard does not add the test to session history. Provider-side billing and retention policies still apply. Microphone access and cloud voice previews require explicit clicks. No automatic fallback changes your provider choice.

## Fresh-install verification

`tests/install/clean_setup_smoke.py` is an opt-in check for a **wheel-installed interpreter** without Hermes or optional speech packages. It launches a temporary loopback service, verifies missing-runtime reporting, asset serving, safe failed model test, completion persistence after restart, and clean shutdown. It does not prove that installing Hermes and authenticating every provider works on every operating system.

Run it from an environment with the built dashboard wheel and `httpx` installed:

```sh
/path/to/clean/python /path/to/project/tests/install/clean_setup_smoke.py
```

Do not run this test in the editable development environment; it explicitly checks that it is testing installed package files.
