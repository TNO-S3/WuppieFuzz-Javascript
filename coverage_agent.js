const v8 = require('node:v8');
const c8 = require('c8');

// Coverage server
const LCOV_HEADER = new Uint8Array([0xc1, 0xc0]);
const BlockType = {
  Header: 0x01,
  SessionInfo: 0x10,
  CoverageInfo: 0x11,
  CmdOk: 0x20,
  CmdDump: 0x40,
}

const fs = require('node:fs');

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

const COVERAGE_PORT = 3001;
let coverage_started = false;

let net = require('net');

let server = net.createServer();

server.on('connection', function (socket) {
  console.log('Coverage connection established.');

  // The server can also receive data from the client by reading from its socket.
  socket.on('data', async function (buf) {
    // buf.subarray(0, 5) = REQUEST_HEADER, unused by us for the time being.
    // buf[5] = command, we only send BLOCK_CMD_DUMP, so this is ignored.
    // buf[6] = boolean that indicates whether or not to retrieve coverage (ignore).
    // Read RESET PARAMETER
    let reset_byte = buf[7];
    if (reset_byte == 0) {
      console.log("Warning: coverage agent does not support getting coverage without reset.");
    }
    let reset = true;
    // Fetch and return coverage data
    if (coverage_started) {
      let cov_data = await get_coverage();
      if (cov_data != null) {
        let header_block = new Block(BlockType.Header, LCOV_HEADER);
        let header_block_buf = header_block.to_buffer();
        socket.write(header_block_buf);
        let coverage_block = new Block(BlockType.CoverageInfo, cov_data)
        let cov_block_buf = coverage_block.to_buffer();
        socket.write(cov_block_buf);
      }
    }
    if (reset) {
      await start_coverage();
    }
    socket.write(Buffer.from([BlockType.CmdOk]));
  });

  // When the client requests to end the TCP connection with the server, the server
  // ends the connection.
  socket.on('end', function () {
    console.log('Closing connection with the client');
  });

  socket.on('error', function (err) {
    console.log(`Error: ${err}`);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Address in use, retrying...');
    setTimeout(() => {
      server.close();
      server.listen(COVERAGE_PORT, '127.0.0.1', function () {
        console.log(`Coverage agent listening on port ${COVERAGE_PORT}`)
      });
    }, 1000);
  }
});
server.listen(COVERAGE_PORT, '127.0.0.1', function () {
  console.log(`Coverage agent listening on port ${COVERAGE_PORT}`)
});

async function start_coverage() {
  if (!coverage_started) {
    v8.takeCoverage();
    coverage_started = true;
    return true;
  } else {
    return false;
  }
}

// Return binary-encoded coverage information
async function get_coverage() {
  if (!coverage_started) {
    console.log("Getting coverage, but haven't started!");
    return false;
  }
  v8.takeCoverage();
  coverage_started = false;
  const opts = {
    all: true,
    return: true,
    reporter: ['lcovonly'],
    deleteCoverage: false,
    tempDirectory: "./node_coverage",
    reportsDirectory: "./coverage_report",
    excludeNodeModules: true
  };
  let myrep = c8.Report(opts);
  await myrep.run();
  // Return the LCOV-formatted coverage report
  return fs.readFileSync("coverage_report/lcov.info");
}