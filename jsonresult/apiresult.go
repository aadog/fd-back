package jsonresult

import (
	"github.com/gin-gonic/gin"
	"reflect"
)

type IApiResult interface {
	Render(ctx *gin.Context,code int)
}

type SimpleSlice struct {
	Count int `json:"count"`
	Data interface{} `json:"data"`
}
type SimpleObject struct {
	Code int`json:"code"`
	Msg string`json:"msg"`
	Data interface{}`json:"data"`
}

func (l *SimpleObject) Render(ctx *gin.Context, code int) {
	switch l.Data.(type) {
	case *SimpleSlice:
		sli:=l.Data.(*SimpleSlice)
		ctx.IndentedJSON(code,gin.H{
			"msg":l.Msg,
			"code":l.Code,
			"count":sli.Count,
			"data":sli.Data,
		})
	case SimpleSlice:
		sli:=l.Data.(SimpleSlice)
		ctx.IndentedJSON(code,gin.H{
			"msg":l.Msg,
			"code":l.Code,
			"count":sli.Count,
			"data":sli.Data,
		})
	default:
		ctx.IndentedJSON(code,l)
	}
}
func NewSimpleResult(obj interface{})IApiResult{
	return &SimpleObject{
		Code: 0,
		Msg:  "操作成功",
		Data: obj,
	}
}
func ToSimpleSlice(obj interface{})(*SimpleSlice,bool){
	switch obj.(type) {
	case *SimpleSlice:
		return obj.(*SimpleSlice),true
	case SimpleSlice:
		return &SimpleSlice{Count: obj.(SimpleSlice).Count,Data: obj.(SimpleSlice).Data},true
	}
	if reflect.ValueOf(obj).Kind()==reflect.Ptr{
		sk:=reflect.ValueOf(obj).Elem()
		if sk.Kind()==reflect.Slice{
			return &SimpleSlice{Count: sk.Len(),Data: sk.Interface()},true
		}
	}
	if reflect.ValueOf(obj).Kind()==reflect.Slice{
		return &SimpleSlice{Count: reflect.ValueOf(obj).Len(),Data: obj},true
	}
	return nil,false
}
func NewSimpleSliceResult(count int,data interface{})IApiResult{
	return &SimpleObject{
		Code: 0,
		Msg:  "操作成功",
		Data: &SimpleSlice{
			Count: count,
			Data:  data,
		},
	}
}