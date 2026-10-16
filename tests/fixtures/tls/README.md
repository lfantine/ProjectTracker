# Public test credentials — never use outside tests

This self-signed certificate and its deliberately public private key exist only
for a loopback HTTPS fixture proving rejection by the native transport. They are
not trusted, contain no user information, and must never be deployed or added to
any trust store. The SDK still rejects loopback before reaching this driver.
