console.log("hello fd")

send({"type":"download","path":"test/test.txt","append":true},new Uint8Array([0x01]).buffer);