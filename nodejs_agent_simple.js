// Coverage server for simple NodeJS applications.
// Simply require it at the top of the main JavaScript file.

const net = require('net');
const runtimeCoverage = require('runtime-coverage');
const {
  exit
} = require('process');

const DEBUG_OUTPUT = false

const COVERAGE_PORT = 3001;
const LCOV_HEADER = new Uint8Array([0xc1, 0xc0]);
const FORMAT_VERSION = new Uint8Array([0x10, 0x07]);
const BlockType = {
  Header: 0x01,
  SessionInfo: 0x10,
  CoverageInfo: 0x11,
  CmdOk: 0x20,
  CmdDump: 0x40,
}

let coverage_started = false;

function log_debug(msg) {
  if (DEBUG_OUTPUT) {
    console.log("coverage agent: " + msg)
  }
}

function concatUInt8Arrays(a1, a2) {
  // sum of individual array lengths
  let mergedArray = new Uint8Array(a1.length + a2.length);
  mergedArray.set(a1);
  mergedArray.set(a2, a1.length);
  return mergedArray;
}

class Block {
  constructor(block_type, block_data) {
    this.block_type = block_type;
    this.block_data = block_data;
  }
  to_buffer() {
    let buf
    if (this.block_type == BlockType.CoverageInfo) {
      buf = Buffer.alloc(1 + 4 + this.block_data.length)
      buf.writeUInt32LE(this.block_data.length, 1);
      buf.fill(this.block_data, 5);
    } else if (this.block_type == BlockType.Header) {
      buf = Buffer.alloc(1 + LCOV_HEADER.length);
      buf.fill(this.block_data, 1);
    }
    buf[0] = this.block_type;
    return buf;
  }
}

const server = net.createServer();

server.on('connection', function (socket) {
  log_debug('Coverage connection established.');
  socket.on('data', async function (buf) {
    // buf.subarray(0, 5) = REQUEST_HEADER, check to aid in detecting concurrency bugs.
    let header_bytes = buf.subarray(0, 5)
    if (Buffer.compare(header_bytes, Buffer.from([0x01, 0xc0, 0xc0, 0x10, 0x07])) != 0) {
      log_debug("HEADER BYTES NOT LCOV:")
      log_debug(header_bytes)
      exit()
    }
    // buf[5] = command, we only send BLOCK_CMD_DUMP, so this is ignored.
    // buf[6] = boolean that indicates whether or not to retrieve coverage (ignore).
    // Read RESET PARAMETER
    let reset_byte = buf[7];
    if (reset_byte == 0) {
      log_debug("Warning: coverage agent resets coverage after each coverage request. Reset bit is ignored.");
    }

    if (!coverage_started) {
      log_debug("*** starting coverage, should only happen once ***");
      coverage_started = true
      await start_coverage();
    } else {
      let cov_data
      try {
        cov_data = await get_coverage_delta();
      } catch (error) {
        log_debug("Error getting coverage:")
        log_debug(error)
      }
      if (cov_data != null) {
        let header_data = concatUInt8Arrays(LCOV_HEADER, FORMAT_VERSION);
        let header_block = new Block(BlockType.Header, header_data);
        let header_block_buf = header_block.to_buffer();
        socket.write(header_block_buf);
        let coverage_block = new Block(BlockType.CoverageInfo, cov_data)
        let cov_block_buf = coverage_block.to_buffer();
        socket.write(cov_block_buf);
      } else {
        log_debug("*** Coverage data is null! ***");
      }
    }
    socket.write(Buffer.from([BlockType.CmdOk]));
  });

  // When the client requests to end the TCP connection with the server, the server
  // ends the connection.
  socket.on('end', function () {
    log_debug('Closing connection with the client');
  });

  socket.on('error', function (err) {
    log_debug(`Error: ${err}`);
  });
});

server.listen(COVERAGE_PORT, '127.0.0.1', function () {
  log_debug(`Coverage agent listening on port ${COVERAGE_PORT}`)
});

// Start block-level (=precise) coverage
// This should only be called once, after which execution counters
// are automatically reset on every get_coverage_delta call.
async function start_coverage() {
  log_debug("start_coverage")
  try {
    await runtimeCoverage.startCoverage();
  } catch (error) {
    log_debug("error starting coverage")
    log_debug.log(error)
  }
}

// Return LCOV-coverage data since start_coverage or get_coverage_delta was last called.
async function get_coverage_delta() {
  const options = {
    all: true,
    forceReload: false,
    return: true,
    reporters: ['lcovonly', 'text'],
  };
  let coverage_promise = runtimeCoverage.getCoverage(options)
  let coverage
  try {
    coverage = await coverage_promise
    await runtimeCoverage.startCoverage()
  } catch (error) {
    log_debug("Problem getting coverage:")
    log_debug(error.message);
    await start_coverage();
    return "coverage not started";
  }
  if (coverage === "coverage not started") {
    return null;
  }
  log_debug("Coverage is:");
  log_debug(coverage["text"]);
  return coverage["lcovonly"];
}

module.exports = {
  start_coverage,
  get_coverage_delta
}