# Email fixtures

These RFC 822 fixtures are entirely synthetic and anonymized by construction: only reserved example.invalid domains, fictional companies and job descriptions are used. The multipart fixture includes HTML, tracking parameters, synthetic contact details and an explicit prompt-injection attempt. It contains no real mailbox credentials or personal messages.

The same bytes are submitted to a disposable Mailpit instance and saved into a disposable Dovecot mailbox in integration tests. Authentication values and TLS keys are generated at test runtime, never committed. No real external mailbox or AI provider is contacted.
