install:
	lerna bootstrap --no-ci

test:
	jest --coverage


start:
	cd packages/server && npm run start
