git pull
go get -u
go get github.com/a97077088/libfridabinres@master
go build -ldflags="-s -w" -tags=tempdll -o fd_macos
upx ./fd_macos
