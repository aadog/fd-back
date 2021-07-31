git pull
go get -u
go get github.com/a97077088/libfridabinres@master
go build -ldflags="-s -w" -tags=tempdll -o fd.exe
upx.exe fd.exe
git add go.sum
git add go.mod
git commit -m "build_windows"
git push