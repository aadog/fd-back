package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
)

func entry()error{
	flag.Usage=func() {
		FlagLsDev.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagCreate.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagRun.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagCompile.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagLsApp.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagLsPs.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagApi.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
		FlagBagBak.Usage()
		fmt.Fprintln(flag.CommandLine.Output(),"")
	}


	if len(os.Args)<2{
		flag.Usage()
		return nil
	}

	cmd:=os.Args[1]
	switch cmd{
	case "lsdev":
		return FlagLsDevMain(os.Args[2:])
	case "lsapp":
		return FlagLsAppMain(os.Args[2:])
	case "lsps":
		return FlagLsPsMain(os.Args[2:])
	case "api":
		return FlagApiMain(os.Args[2:])
	case "compile":
		return FlagCompileMain(os.Args[2:])
	case "run":
		return FlagRunMain(os.Args[2:])
	case "create":
		return FlagCreateMain(os.Args[2:])
	case "bagbak":
		return FlagBagBakMain(os.Args[2:])
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

	return nil
}
