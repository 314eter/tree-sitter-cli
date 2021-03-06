const Parser = require("tree-sitter");
const { assert } = require("chai");
const { dsl, generate, loadLanguage } = require("..");
const { choice, prec, repeat, seq, grammar } = dsl;
const ARITHMETIC = require('./fixtures/arithmetic_language');

describe("Tree", () => {
  let parser;

  beforeEach(() => {
    parser = new Parser();
  });

  describe(".getChangedRanges()", () => {
    let language

    before(() => {
      language = loadLanguage(
        generate(
          grammar({
            name: "test2",
            rules: {
              expression: $ =>
                choice(
                  prec.left(seq($.expression, "+", $.expression)),
                  $.variable
                ),

              variable: $ => /\w+/
            }
          })
        )
      );
    });

    it("reports the ranges of text whose syntactic meaning has changed", () => {
      parser.setLanguage(language);
      const tree1 = parser.parse("abcdefg + hij");

      assert.equal(
        tree1.rootNode.toString(),
        "(expression (expression (variable)) (expression (variable)))"
      );

      tree1.edit({
        startIndex: 2,
        lengthAdded: 3,
        lengthRemoved: 0,
        startPosition: { row: 0, column: 2 },
        extentAdded: { row: 0, column: 3 },
        extentRemoved: { row: 0, column: 0 }
      });

      const tree2 = parser.parse("abc + defg + hij", tree1);
      assert.equal(
        tree2.rootNode.toString(),
        "(expression (expression (expression (variable)) (expression (variable))) (expression (variable)))"
      );

      const ranges = tree1.getChangedRanges(tree2);
      assert.deepEqual(ranges, [
        {
          start: { row: 0, column: 0 },
          end: { row: 0, column: "abc + defg".length }
        }
      ]);
    });

    it('throws an exception if the argument is not a tree', () => {
      parser.setLanguage(language);
      const tree1 = parser.parse("abcdefg + hij");

      assert.throws(() => {
        tree1.getChangedRanges({});
      }, /Argument must be a tree/);
    })
  });

  describe(".edit", () => {
    let language, input, tree;

    before(() => {
      language = loadLanguage(
        generate(
          grammar({
            name: "test",
            rules: {
              sentence: $ => repeat(choice($.word1, $.word2, $.word3, $.word4)),
              word1: $ => "first-word",
              word2: $ => "second-word",
              word3: $ => "αβ",
              word4: $ => "αβδ"
            }
          })
        )
      );
    });

    beforeEach(() => {
      input = {
        offset: 0,
        chunkSize: 3,
        text: "first-word second-word first-word",

        seek(offset, position) {
          assert.deepEqual(position, { row: 0, column: offset });
          this.offset = offset;
        },

        read: function() {
          let result = this.text.slice(
            this.offset,
            this.offset + this.chunkSize
          );
          this.offset += this.chunkSize;
          return result;
        }
      };

      parser.setLanguage(language);
      tree = parser.parse(input);

      assert.equal(
        "(sentence (word1) (word2) (word1))",
        tree.rootNode.toString()
      );
    });

    describe("when text is inserted", () => {
      it("updates the parse tree", () => {
        input.text = "first-word first-word second-word first-word";
        tree.edit({
          startIndex: "first-word ".length,
          lengthAdded: "first-word ".length,
          lengthRemoved: 0,
          startPosition: { row: 0, column: "first-word ".length },
          extentAdded: { row: 0, column: "first-word ".length },
          extentRemoved: { row: 0, column: 0 }
        });

        tree = parser.parse(input, tree);
        assert.equal(
          tree.rootNode.toString(),
          "(sentence (word1) (word1) (word2) (word1))"
        );
      });
    });

    describe("when text is removed", () => {
      it("updates the parse tree", () => {
        input.text = "first-word first-word";
        tree.edit({
          startIndex: "first-word ".length,
          lengthAdded: 0,
          lengthRemoved: "second-word ".length,
          startPosition: { row: 0, column: "first-word ".length },
          extentAdded: { row: 0, column: 0 },
          extentRemoved: { row: 0, column: "second-word ".length }
        });

        tree = parser.parse(input, tree);
        assert.equal(tree.rootNode.toString(), "(sentence (word1) (word1))");
      });
    });

    describe("when the text contains non-ascii characters", () => {
      beforeEach(() => {
        input.text = "αβ αβ αβ";
        tree = parser.parse(input);
        assert.equal(
          tree.rootNode.toString(),
          "(sentence (word3) (word3) (word3))"
        );
      });

      it("updates the parse tree correctly", () => {
        input.text = "αβδ αβ αβ";
        tree.edit({
          startIndex: 2,
          lengthAdded: 1,
          lengthRemoved: 0,
          startPosition: { row: 0, column: 2 },
          extentAdded: { row: 0, column: 1 },
          extentRemoved: { row: 0, column: 0 }
        });

        tree = parser.parse(input, tree);
        assert.equal(
          tree.rootNode.toString(),
          "(sentence (word4) (word3) (word3))"
        );
      });
    });
  });

  describe(".walk()", () => {
    beforeEach(() => {
      parser.setLanguage(ARITHMETIC);
    });

    it('returns a cursor that can be used to walk the tree', () => {
      const tree = parser.parse('a * b + c / d');

      const cursor = tree.walk();
      assert.equal(cursor.nodeType, 'program');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 0});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 13});
      assert.deepEqual(cursor.startIndex, 0);
      assert.deepEqual(cursor.endIndex, 13);

      assert(cursor.gotoFirstChild());
      assert.equal(cursor.nodeType, 'sum');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 0});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 13});
      assert.deepEqual(cursor.startIndex, 0);
      assert.deepEqual(cursor.endIndex, 13);

      assert(cursor.gotoFirstChild());
      assert.equal(cursor.nodeType, 'product');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 0});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 5});
      assert.deepEqual(cursor.startIndex, 0);
      assert.deepEqual(cursor.endIndex, 5);

      assert(cursor.gotoFirstChild());
      assert.equal(cursor.nodeType, 'variable');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 0});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 1});
      assert.deepEqual(cursor.startIndex, 0);
      assert.deepEqual(cursor.endIndex, 1);

      assert(!cursor.gotoFirstChild())
      assert(cursor.gotoNextSibling());
      assert.equal(cursor.nodeType, '*');
      assert.equal(cursor.nodeIsNamed, false);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 2});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 3});
      assert.deepEqual(cursor.startIndex, 2);
      assert.deepEqual(cursor.endIndex, 3);

      assert(cursor.gotoNextSibling());
      assert.equal(cursor.nodeType, 'variable');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 4});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 5});
      assert.deepEqual(cursor.startIndex, 4);
      assert.deepEqual(cursor.endIndex, 5);

      assert(!cursor.gotoNextSibling());
      assert(cursor.gotoParent());
      assert.equal(cursor.nodeType, 'product');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 0});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 5});
      assert.deepEqual(cursor.startIndex, 0);
      assert.deepEqual(cursor.endIndex, 5);

      assert(cursor.gotoNextSibling());
      assert.equal(cursor.nodeType, '+');
      assert.equal(cursor.nodeIsNamed, false);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 6});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 7});
      assert.deepEqual(cursor.startIndex, 6);
      assert.deepEqual(cursor.endIndex, 7);

      assert(cursor.gotoNextSibling());
      assert.equal(cursor.nodeType, 'quotient');
      assert.equal(cursor.nodeIsNamed, true);
      assert.deepEqual(cursor.startPosition, {row: 0, column: 8});
      assert.deepEqual(cursor.endPosition, {row: 0, column: 13});
      assert.deepEqual(cursor.startIndex, 8);
      assert.deepEqual(cursor.endIndex, 13);

      assert(!cursor.gotoNextSibling());
      assert(cursor.gotoParent());
      assert(cursor.gotoParent());
      assert(!cursor.gotoParent());
    });
  });
});
