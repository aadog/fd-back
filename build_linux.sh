git pull
go get -u
go get github.com/a97077088/libfridabinres@master
go build -ldflags="-s -w" -tags=tempdll -o fd_linux
upx ./fd_linux
git add go.sum
git add go.mod
git commit -m "fd_linux"
git push
