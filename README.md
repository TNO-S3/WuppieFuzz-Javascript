# WuppieFuzz

TNO developed WuppieFuzz, a coverage-guided REST API fuzzer developed on top of
LibAFL, targeting a wide audience of end-users, with a strong focus on
ease-of-use, explainability of the discovered flaws and modularity. WuppieFuzz
supports all three settings of testing (black box, grey box and white box).

## WuppieFuzz-Javascript

This is a fairly diverse environment, there are:

- various flavors of JavaScript (CommonJS, ES2015==ES6, more but these are the
  main ones)
- NodeJS vs browser-based code.
- async and non-async functions
- modules and non-modules

### NodeJS agents

We currently supply two agents for NodeJS. You can incorporate both of these
into your projects by adding a `require`-statement for the respective agent at
the top of your `app.ts`, `app.js` or whatever is the entry point of your
application. See the examples directory for concrete examples.

#### Usage:

```javascript
require("./coverage_agent");

// Your code
```

It's that simple. The coverage agent exposes a server that accepts commands from
the `coverage_client`. Note that when the node process exits, the coverage
server goes down with it. Check the examples to see the coverage agent in
action.

#### NodeJS agent 1: v8 (`coverage_agent.js`)

This uses
[node-specific built-in functionality of v8](https://v8.dev/blog/javascript-code-coverage)
for taking coverage. It works like this:

1. **Coverage tracking**: Generate coverage files with the
   [minimal Node-API: `v8.takeCoverage()`](https://nodejs.org/api/v8.html#v8takecoverage).
   This writes a file to disk (~100KB-10MB) for every input that we send. **No
   customization is possible**, so the huge amount of node_modules also gets
   instrumented and reported on. Hopefully we can circumvent both the
   file-writing and the instrument-everything problems at some point, but it
   seems like a daunting task to dig deeply into v8 and use/customize its
   inspector.
2. **Conversion into LCOV**: Read in the coverage files written so far and
   process them into coverage reports using a c8-reporter (in particular we use
   the `lcovonly`-reporter). At this stage we can **exclude e.g. the
   node_modules**. Read in the LCOV coverage report
   (`./coverage_report/lcov.info`) and return its contents to WuppieFuzz.

Optional (and working): Use c8 to also create an HTML-report out of all the
coverage files. This takes a second or so, but is extremely useful for
identifying bottlenecks for the fuzzer. Prerequisite is a directory with
coverage data as written by `v8.takeCoverage()` named "node_coverage" in your
working directory. You can then generate the html report with
`node <path-to-create_coverage_report.mjs>`, which will be written to
`./coverage_report` just like the `lcov.info` during fuzzing. You can view the
report by opening `index.html` in a browser.

#### NodeJS Agent 2: runtime-coverage (`nodejs_agent_simple.js`)

This agent can be used both in CommonJS and ES2015, is synchronous (its
`start_coverage` and `get_coverage` functions are async, but must always be
`await`ed on), and is a non-module.

This agent uses the npm module `runtime-coverage`, with the following
(simplified) dependency tree:

- runtime-coverage

  - collect-v8-coverage

    - inspector

  - v8-to-istanbul

  - istanbul-lib-coverage

  - istanbul-lib-report

  - istanbul-reports

This agent listens for coverage requests and has a very simple behaviour:

1. On the first coverage request, start tracking coverage.
2. On any subsequent coverage request, return coverage recorded since the last
   coverage request.

Resetting of coverage is automatic, it is up to the client to calculate total
coverage from multiple inputs if that is desired.

#### Which agent to pick

For simplicity try out agent 2, and if this does not work try with agent 1.
Agent 1 has the added complexity of requiring an environment variable and
intermediate file-writes (also possibly impacting performance), but gives more
accurate coverage in some scenarios (see the feathers example).

#### Limitations

1. Note that the agent goes down with the target, so for **microservices** that
   live only as long as it takes to process an application request this is
   inadequate.
2. The agent works for CommonJS (default for nodejs), it is unclear whether and
   how it can be used with **ES2016** modules.
