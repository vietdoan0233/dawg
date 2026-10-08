// Run: node scripts/check-csv.mjs  (Node 22.18+/24 strips the .ts types natively)
import assert from "node:assert/strict";
import { guessTarget, parseCsv, toCsv } from "../lib/csv.ts";

// quotes, escaped quotes, a newline inside a cell, CRLF, blank lines, trimmed cells
assert.deepEqual(parseCsv('email,name\r\n a@aalto.fi ,"Doe, ""J""\nJr"\r\n\r\nb@aalto.fi,B\n'), [
  ["email", "name"],
  ["a@aalto.fi", 'Doe, "J"\nJr'],
  ["b@aalto.fi", "B"],
]);
assert.deepEqual(parseCsv("Sähköposti;Nimi\nx@aalto.fi;X, Y"), [["Sähköposti", "Nimi"], ["x@aalto.fi", "X, Y"]]); // Finnish Excel
assert.deepEqual(parseCsv("only,header"), [["only", "header"]]);

// formula injection escaped, numbers (also negative) untouched, quoting round-trips
assert.equal(toCsv([["=1+1", "+x", "-y", "@z", "ok"], [-5, 3]]), "'=1+1,'+x,'-y,'@z,ok\r\n-5,3\r\n");
assert.deepEqual(parseCsv(toCsv([['a,"b"', "c;d"]])), [['a,"b"', "c;d"]]);

assert.equal(guessTarget("Sähköposti", []), "email");
assert.equal(guessTarget("Tutor group", []), "group");
assert.equal(guessTarget("ilmo/culture", ["Ilmo / Culture", "Sports"]), "category:Ilmo / Culture");
assert.equal(guessTarget("Favourite colour", ["Sports"]), null);
console.log("csv ok");
