package jsonresult

import (
	"github.com/gin-gonic/gin"
)

type IApiError interface {
	Render(ctx *gin.Context,code int)
}
type SimpleError struct {
	Err error
	Code int`json:"code"`
	Msg string`json:"msg"`
	Data interface{}`json:"data"`
}

func (l *SimpleError) Render(ctx *gin.Context, code int) {
	ctx.IndentedJSON(code,gin.H{
		"msg":l.Msg,
		"code":l.Code,
		"data":l.Data,
	})
}
func NewSimpleError(err error,obj interface{})IApiError{
	return &SimpleError{
		Err: err,
		Code: -1,
		Msg:  err.Error(),
		Data: obj,
	}
}





