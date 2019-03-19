module.exports = {
    "mode": "modules",
    "out": "docs",
    exclude: [
        '**/node_modules/**',
        '**/sample-todomvc-angular/**',
        '**/integration/**',
        '**/*.spec.ts',
        'website/**/*',
    ],
    name: 'glut.ts',
    lernaExclude: ['@marcj/glut-integration', '@marcj/glut-sample-angular'],
    excludePrivate: true,
    skipInternal: true
};
