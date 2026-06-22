.PHONY: dev start install uninstall pack clean

SRCS := $(shell find src -name '*.ts')
BUILD_DEPS := $(SRCS) tsconfig.json package.json

dist/index.js: $(BUILD_DEPS)
	pnpm build

dev:
	pnpm dev

start: dist/index.js
	pnpm start

install: dist/index.js
	npm install -g .

uninstall:
	npm uninstall -g proxa

pack: dist/index.js
	npm pack

clean:
	rm -rf dist *.tgz
