package api

import (
	"github.com/0xUnixIO/incuspace/internal/api/handler"
	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/images"
	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/0xUnixIO/incuspace/internal/instances"
	"github.com/0xUnixIO/incuspace/internal/plans"
	"github.com/0xUnixIO/incuspace/internal/quota"
	"github.com/0xUnixIO/incuspace/internal/sshkeys"
	"github.com/0xUnixIO/incuspace/internal/users"
	"github.com/go-chi/chi/v5"
)

func Register(r chi.Router, client *incus.Client, keys *sshkeys.Store, quotas *quota.Store,
	usersRepo *users.Repo, instsRepo *instances.Repo,
	plansRepo *plans.Repo, allowedImagesRepo *images.Repo) *handler.Handler {
	h := handler.New(client, keys, quotas, usersRepo, instsRepo, plansRepo, allowedImagesRepo)

	r.Route("/api/v1", func(r chi.Router) {
		// 公开路由
		r.Post("/auth/login", h.Login)

		// 需要认证的路由
		// WebSocket 控制台：浏览器 WS 无法设置 header，通过 query token 认证
		r.Get("/instances/{name}/console", h.Console)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware)

			// 当前用户
			r.Get("/auth/me", h.Me)

			// 用户管理（admin only）
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireAdmin)
				r.Get("/users", h.ListUsers)
				r.Post("/users", h.CreateUser)
				r.Delete("/users/{id}", h.DeleteUser)
				r.Put("/users/{id}/port-range", h.UpdateUserPortRange)
			})
			// 改密：self 或 admin
			r.Put("/users/{id}/password", h.UpdateUserPassword)

			// 实例
			r.Get("/instances", h.ListInstances)
			r.Post("/instances", h.CreateInstance)

			// 单实例操作（统一所有权校验）
			r.Group(func(r chi.Router) {
				r.Use(h.OwnerCheck)
				r.Get("/instances/{name}", h.GetInstance)
				r.Get("/instances/{name}/panel-info", h.GetInstancePanelInfo)
				r.Patch("/instances/{name}/config", h.PatchInstanceConfig)
				r.Delete("/instances/{name}", h.DeleteInstance)
				r.Put("/instances/{name}/action", h.InstanceAction)
				r.Get("/instances/{name}/state", h.GetInstanceState)

				// 实例快照
				r.Get("/instances/{name}/snapshots", h.ListSnapshots)
				r.Post("/instances/{name}/snapshots", h.CreateSnapshot)
				r.Delete("/instances/{name}/snapshots/{snap}", h.DeleteSnapshot)
				r.Post("/instances/{name}/snapshots/{snap}/restore", h.RestoreSnapshot)

				// 文件管理
				r.Get("/instances/{name}/files", h.ListInstanceFiles)
				r.Get("/instances/{name}/files/download", h.DownloadInstanceFile)
				r.Post("/instances/{name}/files", h.UploadInstanceFile)
				r.Delete("/instances/{name}/files", h.DeleteInstanceFile)

				// 实例 SSH 公钥
				r.Get("/instances/{name}/ssh-keys", h.GetInstanceSSHKeys)
				r.Put("/instances/{name}/ssh-keys", h.PutInstanceSSHKeys)

				// 网卡限速
				r.Get("/instances/{name}/bandwidth", h.GetBandwidth)
				r.Put("/instances/{name}/bandwidth", h.PutBandwidth)

				// 流量配额
				r.Get("/instances/{name}/quota", h.GetQuota)
				r.Put("/instances/{name}/quota", h.PutQuota)
				r.Delete("/instances/{name}/quota", h.DeleteQuota)
				r.Post("/instances/{name}/quota/reset", h.ResetQuota)

				// 端口转发
				r.Get("/instances/{name}/proxy-rules", h.ListProxyRules)
				r.Post("/instances/{name}/proxy-rules", h.AddProxyRule)
				r.Delete("/instances/{name}/proxy-rules/{devname}", h.DeleteProxyRule)
			})

			// 套餐
			r.Get("/plans", h.ListPlans)
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireAdmin)
				r.Post("/plans", h.CreatePlan)
				r.Patch("/plans/{id}", h.UpdatePlan)
				r.Delete("/plans/{id}", h.DeletePlan)
			})

			// 允许镜像（白名单）
			r.Get("/allowed-images", h.ListAllowedImages)
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireAdmin)
				r.Post("/allowed-images", h.CreateAllowedImage)
				r.Delete("/allowed-images/{id}", h.DeleteAllowedImage)
			})

			// 镜像
			r.Get("/images", h.ListImages)
			r.Delete("/images/{fingerprint}", h.DeleteImage)
			r.Get("/images/remote", h.ListRemoteImages)
			r.Post("/images/pull", h.PullImage)

			// 网络
			r.Get("/networks", h.ListNetworks)
			r.Post("/networks", h.CreateNetwork)
			r.Delete("/networks/{name}", h.DeleteNetwork)

			// 存储池
			r.Get("/storage-pools", h.ListStoragePools)

			// 异步操作
			r.Get("/operations", h.ListOperations)

			// SSH 公钥管理（面板全局）
			r.Get("/ssh-keys", h.ListSSHKeys)
			r.Post("/ssh-keys", h.AddSSHKey)
			r.Delete("/ssh-keys/{id}", h.DeleteSSHKey)

			// 宿主机信息
			r.Get("/host-info", h.HostInfo)
		})
	})
	return h
}
