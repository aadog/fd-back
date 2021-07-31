go get -u
go build -ldflags="-s -w" -tags=tempdll
upx.exe fd.exe