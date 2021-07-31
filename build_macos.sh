git pull
go get -u
go get github.com/a97077088/libfridabinres@master
go build -ldflags="-s -w" -tags=tempdll -o fd_macos
upx ./fd_macos
git add go.sum
git add go.mod
git commit -m "build_macos"
git push
