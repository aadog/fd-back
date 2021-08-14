package main

import (
	"bytes"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"strings"
)
//go:embed frida-agent-example
var frida_agent_example embed.FS


var FlagCreate =flag.NewFlagSet("create",flag.ExitOnError)
func init(){
	FlagCreate.Usage= func() {
		fmt.Fprintf(FlagCreate.Output(), "============== 创建工程 使用方法:%s\n", "create pdir")
		FlagCreate.PrintDefaults()
	}
}

func FlagCreateMain(args []string)error{
	if len(args)<1{
		fmt.Println("解析目录失败")
		FlagCreate.Usage()
		return nil
	}
	create_dir:=args[0]
	FlagCreate.Parse(args[1:])
	if FlagCreate.Parsed(){
		return NewCreate().Run(CreateParam{Dir: create_dir})
	}
	return errors.New("create命令解析失败")
}


type CreateParam struct {
	Dir string
}
type Create struct {

}

func (l *Create) Run(param CreateParam) error {
	if param.Dir==""{
		return errors.New("还没有指定创建的目录")
	}
	err:=os.MkdirAll(param.Dir,os.ModePerm)
	if err!=nil{
	    return err
	}
	err=fs.WalkDir(frida_agent_example,".", func(path string, d fs.DirEntry, err error) error {
		if path=="."{
			return nil
		}
		if d.IsDir(){
			topath:=strings.ReplaceAll(path,"frida-agent-example",param.Dir)
			err=os.MkdirAll(topath,os.ModePerm)
			if err!=nil{
			    return err
			}
		}else{
			o,err:=frida_agent_example.ReadFile(path)
			if err!=nil{
			    return err
			}
			o=bytes.ReplaceAll(o,[]byte("frida-agent-example"), []byte(param.Dir))
			topath:=strings.ReplaceAll(path,"frida-agent-example",param.Dir)
			err=os.WriteFile(topath,o,os.ModePerm)
			if err!=nil{
			    return err
			}
		}
		return nil
	})
	if err!=nil{
	    return err
	}
	fmt.Println("创建工程成功:",param.Dir)
	fmt.Println("执行以下命令")
	fmt.Println()
	fmt.Println("cd ",param.Dir)
	fmt.Println("npm install")
	fmt.Println("npm run watch")
	fmt.Println("run _agent.js -name 通讯录")
	return nil
}

func NewCreate() *Create {
	return &Create{}
}
