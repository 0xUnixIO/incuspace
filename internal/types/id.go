// Package types 提供跨包共享的基础类型，主要是 BIGINT JSON 字符串化。
package types

import (
	"encoding/json"
	"strconv"
)

// ID int64 序列化为 JSON 字符串（避免 JS 数字精度丢失）。
type ID int64

func (id ID) MarshalJSON() ([]byte, error) {
	return []byte(`"` + strconv.FormatInt(int64(id), 10) + `"`), nil
}

func (id *ID) UnmarshalJSON(data []byte) error {
	s := string(data)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		var raw string
		if err := json.Unmarshal(data, &raw); err != nil {
			return err
		}
		s = raw
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return err
	}
	*id = ID(v)
	return nil
}

func (id ID) Int64() int64   { return int64(id) }
func (id ID) String() string { return strconv.FormatInt(int64(id), 10) }
