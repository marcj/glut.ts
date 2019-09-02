install:
	lerna bootstrap --hoist --no-ci

test:
	jest --coverage

server-start:
	cd packages/server && npm run start

setup-test-env:
	redis-server&
	mongod --dbpath /tmp/mongo-test &
