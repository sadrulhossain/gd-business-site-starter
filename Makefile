SHELL := /bin/sh
COMPOSE := docker compose
LOG := .cache/make.log

# run quietly: log everything, print only the last 20 lines on failure
define quiet
mkdir -p .cache; $(1) >$(LOG) 2>&1 || { tail -n 20 $(LOG); exit 1; }
endef

.PHONY: up down ports versions security t check env web seed seed-core

env:
	@[ -f .env ] || { cp .env.example .env; echo "created .env from .env.example"; }

up: env
	@$(call quiet,sh scripts/check-ports.sh)
	@$(call quiet,$(COMPOSE) up -d --wait --quiet-pull)
	@$(COMPOSE) ps --format '{{.Name}} {{.Status}}'

down:
	@$(call quiet,$(COMPOSE) down --remove-orphans)
	@echo "stack down"

ports:
	@sh scripts/check-ports.sh

versions:
	@bad=0; for kv in $$(grep -E '^[A-Z_]+_VERSION=' .env); do \
	  k=$${kv%%=*}; v=$${kv#*=}; \
	  if grep -qF "| $$v " docs/VERSIONS.md; then echo "ok       $$k=$$v"; else echo "MISMATCH $$k=$$v"; bad=1; fi; \
	done; exit $$bad

# security gates: secrets in the repo, versions below their floor, dependency advisories (docs/SECURITY.md)
security:
	@sh scripts/check-secrets.sh
	@node scripts/check-floors.mjs | tail -n 1
	@$(call quiet,$(COMPOSE) exec -T node sh -c 'cd /app && pnpm audit --prod --audit-level=high')

# targeted tests: make t FILTER=SomeTest
seed:
	@$(COMPOSE) exec -T node sh -c 'cd /app/api && pnpm run seed -- --demo' 2>&1 | tail -n 5

seed-core:
	@$(COMPOSE) exec -T node sh -c 'cd /app/api && pnpm run seed' 2>&1 | tail -n 5

t:
	@[ -n "$(FILTER)" ] || { echo "usage: make t FILTER=<name>"; exit 2; }
	@$(COMPOSE) exec -T node sh -c 'cd /app/api && pnpm exec vitest run -t "$(FILTER)"' 2>&1 | tail -n 15

# run once at the end of a phase (needs the stack up). The route audit is added in M2.
check:
	@$(call quiet,$(COMPOSE) config -q)
	@for f in scripts/*.sh docker/*/*.sh; do sh -n $$f || exit 1; done
	@[ -n "$$($(COMPOSE) ps --status running -q node)" ] || { echo "check: stack is down, run make up"; exit 1; }
	@$(call quiet,$(COMPOSE) exec -T node sh -c 'cd /app && pnpm -r --if-present typecheck')
	@$(call quiet,$(COMPOSE) exec -T node sh -c 'cd /app && pnpm -r --if-present test')
	@$(MAKE) --no-print-directory versions
	@$(MAKE) --no-print-directory security
	@echo "check: ok"
