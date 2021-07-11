package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
)

func entry()error{

	create:=flag.NewFlagSet("create",flag.ExitOnError)
	create.Usage= func() {
		fmt.Fprintf(create.Output(), "创建工程 使用方法:%s\n", "create pdir")
		create.PrintDefaults()
	}
	create_dir:=""


	run:=flag.NewFlagSet("run",flag.ExitOnError)
	run.Usage= func() {
		fmt.Fprintf(run.Output(), "脚本调试 使用方法:%s\n", "run 1.js -name 通讯录")
		run.PrintDefaults()
	}
	run_name:=run.String("name","","调试进程名称,比如 通讯录,(lsps的结果中可以看到)")
	run_jsbyte:=run.Bool("jsbyte",false,"是否使用编译过的js 字节码")
	run_jspath:=""

	compile:=flag.NewFlagSet("compile",flag.ExitOnError)
	compile.Usage= func() {
		fmt.Fprintf(compile.Output(), "脚本编译 使用方法:%s\n", "compile 1.js -name 通讯录")
		compile.PrintDefaults()
	}
	compile_jspath:=""
	compile_name:=compile.String("name","","app屏幕上看到的名字,比如 通讯录,(lsps的结果中可以看到)")

	lsapp:=flag.NewFlagSet("lsapp",flag.ExitOnError)
	lsapp.Usage= func() {
		fmt.Fprintf(lsapp.Output(), "列出所有application 使用方法:%s\n", "lsapp")
		lsapp.PrintDefaults()
	}

	lsps:=flag.NewFlagSet("lsps",flag.ExitOnError)
	lsps.Usage= func() {
		fmt.Fprintf(lsps.Output(), "列出所有进程 使用方法:%s\n", "lsps")
		lsps.PrintDefaults()
	}

	api:=flag.NewFlagSet("api",flag.ExitOnError)
	api.Usage= func() {
		fmt.Fprintf(api.Output(), "api导出 使用方法:%s\n", "api 1.js -name 通讯录")
		api.PrintDefaults()
	}
	api_http:=api.Bool("http",true,"导出http接口")
	api_grpc:=api.Bool("grpc",false,"导出grpc接口(暂时还不支持)")
	api_jspath:=""
	api_jsbyte:=api.Bool("jsbyte",false,"是否使用编译过的js 字节码")
	api_name:=api.String("name","","app屏幕上看到的名字,比如 通讯录,(lsps的结果中可以看到)")
	api_address:=api.String("address",":8080","接口监听地址")
	api_path:=api.String("path","/call","api监听路径")


	flag.Usage=func() {
		create.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		run.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		compile.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		lsapp.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		lsps.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		api.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
	}


	if len(os.Args)<2{
		flag.Usage()
		return nil
	}
	cmd:=os.Args[1]
	switch cmd{

	case "lsapp":
		lsapp.Parse(os.Args[2:])
	case "lsps":
		lsps.Parse(os.Args[2:])
	case "api":
		if len(os.Args)<3{
			fmt.Println("解析js文件失败")
			compile.Usage()
		}
		a2:=os.Args[2]
		if a2=="help"||a2=="-help"||a2=="--help"||a2=="-h"||a2=="--h"||strings.HasPrefix(a2,"-"){
			fmt.Println("解析js文件失败")
			api.Usage()
			return nil
		}
		api_jspath=os.Args[2]
		api.Parse(os.Args[3:])
		if *compile_name==""{
			fmt.Println("name参数解析失败")
			api.Usage()
			return nil
		}
	case "compile":
		if len(os.Args)<3{
			fmt.Println("解析js文件失败")
			compile.Usage()
			return nil
		}
		a2:=os.Args[2]
		if a2=="help"||a2=="-help"||a2=="--help"||a2=="-h"||a2=="--h"||strings.HasPrefix(a2,"-"){
			fmt.Println("解析js文件失败")
			compile.Usage()
			return nil
		}
		compile_jspath=a2
		compile.Parse(os.Args[3:])
		if *compile_name==""{
			fmt.Println("name参数解析失败")
			compile.Usage()
			return nil
		}
	case "run":
		if len(os.Args)<3{
			fmt.Println("解析js文件失败")
			run.Usage()
			return nil
		}
		a2:=os.Args[2]
		if a2=="help"||a2=="-help"||a2=="--help"||a2=="-h"||a2=="--h"||strings.HasPrefix(a2,"-"){
			fmt.Println("解析js文件失败")
			run.Usage()
			return nil
		}
		run_jspath=a2
		run.Parse(os.Args[3:])
		if *run_name==""{
			fmt.Println("name参数解析失败")
			run.Usage()
			return nil
		}
	case "create":
		if len(os.Args)<3{
			fmt.Println("解析目录失败")
			create.Usage()
			return nil
		}
		a2:=os.Args[2]
		if a2=="help"||a2=="-help"||a2=="--help"||a2=="-h"||a2=="--h"||strings.HasPrefix(a2,"-"){
			fmt.Println("解析目录失败")
			create.Usage()
			return nil
		}
		create_dir=a2
		create.Parse(os.Args[3:])
	case "help":
		flag.Usage()
	case "-h":
		flag.Usage()
	case "--h":
		flag.Usage()
	case "-help":
		flag.Usage()
	case "--help":
		flag.Usage()
	default:
		return errors.New("不支持这个命令行")
	}
	if lsapp.Parsed(){
		return NewLsApp().Run()
	}
	if lsps.Parsed(){
		return NewLsPs().Run()
	}
	if api.Parsed(){

		kd:=0
		if *api_http{
			kd=0
		}
		if *api_grpc{
			kd=1
		}

		return NewApi().Run(ApiParam{ApiType: kd,JsPath: api_jspath,JsByte: *api_jsbyte,Name:*api_name,Address: *api_address,Path: *api_path})
	}
	if compile.Parsed(){
		return NewCompile().Run(CompileParam{JsPath: compile_jspath,Name:*compile_name})
	}
	if run.Parsed(){
		return NewRun().Run(RunParam{JsPath: run_jspath,Name:*run_name,JsByte: *run_jsbyte})
	}
	if create.Parsed(){
		return NewCreate().Run(CreateParam{Dir: create_dir})
	}
	return nil
}
