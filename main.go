package main

import (
	"embed"
	_ "embed"
	"fmt"
)

//go:embed scripts/*/*
var scripts embed.FS

func main() {
	err:=entry()
	if err!=nil{
	  fmt.Println(err)
	}
}

