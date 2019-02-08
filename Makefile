install:
	lerna bootstrap --hoist --no-ci

test:
	jest --coverage

server-start:
	cd packages/server && npm run start
