/*
function convertTSVToJson(tsvData) {
    // Split into lines
    const lines = tsvData.split("\r\n").filter(line => line.trim() !== "");

    // Extract headers
    const headers = lines[0].split("\t");

    // Process each row
    const jsonData = lines.slice(1).map(line => {
        const values = line.split("\t");
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || ""; // Handle empty values
            return obj;
        }, {});
    });

    return jsonData;
}
*/

/*function convertTSVToJson(tsv) {
    // Split the TSV data into rows
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
  
    // Extract the headers (first row)
    const headers = rows[0].split("\t");
  
    // Convert each subsequent row to a JSON object
    const jsonData = rows.slice(1).map(row => {
      const values = row.split("\t");
      return headers.reduce((obj, header, index) => {
        obj[header] = values[index] || ""; // Provide a default empty string if missing
        return obj;
      }, {});
    });
  
    return jsonData;
  }
*/


function convertTSVToJson(tsv) {
    // Split the TSV data into rows (using newline)
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
  
    // The first row is the header
    const headers = rows[0].split("\t");
  
    // Map each subsequent row into an object with keys from headers
    const jsonData = rows.slice(1).map(row => {
      const values = row.split("\t");
      return headers.reduce((obj, header, index) => {
        obj[header] = values[index] || "";
        return obj;
      }, {});
    });
  
    return jsonData;
  }


module.exports = convertTSVToJson;