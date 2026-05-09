package quota

import (
	"context"
	"log"
	"time"

	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/0xUnixIO/incuspace/internal/instances"
	incusapi "github.com/lxc/incus/v6/shared/api"
)

const pollInterval = 30 * time.Second

type Monitor struct {
	store  *Store
	insts  *instances.Repo
	client *incus.Client
}

func NewMonitor(store *Store, insts *instances.Repo, client *incus.Client) *Monitor {
	return &Monitor{store: store, insts: insts, client: client}
}

func (m *Monitor) Run(ctx context.Context) {
	t := time.NewTicker(pollInterval)
	defer t.Stop()
	m.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.tick(ctx)
		}
	}
}

func (m *Monitor) tick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("quota monitor panic: %v", r)
		}
	}()
	list, err := m.store.List(ctx)
	if err != nil {
		log.Printf("quota monitor list: %v", err)
		return
	}
	for _, q := range list {
		m.checkOne(ctx, q)
	}
}

func (m *Monitor) checkOne(ctx context.Context, q Quota) {
	inst, err := m.insts.Get(ctx, q.InstanceID)
	if err != nil {
		return
	}
	state, _, err := m.client.Server().GetInstanceState(inst.Name)
	if err != nil {
		return
	}
	var rx, tx int64
	for iface, n := range state.Network {
		if iface == "lo" {
			continue
		}
		rx += n.Counters.BytesReceived
		tx += n.Counters.BytesSent
	}
	now := time.Now()
	var triggered bool
	var action string

	_ = m.store.UpdateCounters(ctx, q.InstanceID, func(q *Quota) {
		if q.Period == "monthly" && !sameMonth(q.LastResetAt, now) {
			q.UsedBytes = 0
			q.LastResetAt = now
			q.Triggered = false
		}
		dRx := rx - q.LastBytesRx
		dTx := tx - q.LastBytesTx
		if dRx < 0 {
			dRx = rx
		}
		if dTx < 0 {
			dTx = tx
		}
		if q.LastPollAt.IsZero() {
			dRx, dTx = 0, 0
		}
		q.UsedBytes += dRx + dTx
		q.LastBytesRx = rx
		q.LastBytesTx = tx
		q.LastPollAt = now
		if q.LimitBytes > 0 && q.UsedBytes >= q.LimitBytes && !q.Triggered {
			q.Triggered = true
			triggered = true
			action = q.Action
		}
	})

	if triggered {
		m.executeAction(inst.Name, action)
	}
}

func (m *Monitor) executeAction(name, action string) {
	log.Printf("quota: instance=%s action=%s (over limit)", name, action)
	switch action {
	case "stop", "freeze":
		op, err := m.client.Server().UpdateInstanceState(name, incusapi.InstanceStatePut{
			Action:  action,
			Timeout: 30,
			Force:   false,
		}, "")
		if err != nil {
			log.Printf("quota: %s %s 失败: %v", action, name, err)
			return
		}
		if err := op.Wait(); err != nil {
			log.Printf("quota: %s %s 等待失败: %v", action, name, err)
		}
	}
}

func sameMonth(a, b time.Time) bool {
	return a.Year() == b.Year() && a.Month() == b.Month()
}
