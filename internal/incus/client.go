package incus

import (
	incusclient "github.com/lxc/incus/v6/client"
)

// Client 封装 Incus 连接
type Client struct {
	server incusclient.InstanceServer
}

func NewClient(socketPath string) (*Client, error) {
	srv, err := incusclient.ConnectIncusUnix(socketPath, nil)
	if err != nil {
		return nil, err
	}
	return &Client{server: srv}, nil
}

func (c *Client) Server() incusclient.InstanceServer {
	return c.server
}
