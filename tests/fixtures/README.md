`image.jpg` is an integration-test fixture sourced from Unsplash:
https://images.unsplash.com/photo-1442512595331-e89e73853f31

License: https://unsplash.com/license

`audio.opus` is a synthetic 440 Hz mono tone generated for the Opus upload
regression tests, with no recorded speech or third-party media. It contains 50
20 ms frames encoded by libopus at 48 kHz and wrapped in Ogg pages with valid
checksums. Its detected MIME type is `audio/ogg; codecs=opus`.

`video.webm` is a synthetic 160×90 VP8 video generated with Chromium's
`canvas.captureStream(10)` and `MediaRecorder` (`video/webm;codecs=vp8`).
It alternates solid green/yellow frames for one second, without audio or
third-party media. It exercises real container validation and browser playback.

`video.mp4` is the same synthetic canvas animation recorded as H.264 Baseline
with Chromium's `MediaRecorder` (`video/mp4;codecs=avc1.42001E`). The API tests
also exercise QuickTime detection by changing its major container brand to `qt  `.
