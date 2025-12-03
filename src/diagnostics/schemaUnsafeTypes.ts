import { pipe } from "effect"
import * as Array from "effect/Array"
import * as Option from "effect/Option"
import type ts from "typescript"
import * as LSP from "../core/LSP.js"
import * as Nano from "../core/Nano.js"
import * as TypeParser from "../core/TypeParser.js"
import * as TypeScriptApi from "../core/TypeScriptApi.js"
import * as TypeScriptUtils from "../core/TypeScriptUtils.js"

export const schemaUnsafeTypes = LSP.createDiagnostic({
  name: "schemaUnsafeTypes",
  code: 35,
  severity: "off",
  apply: Nano.fn("schemaUnsafeTypes.apply")(function*(sourceFile, report) {
    const ts = yield* Nano.service(TypeScriptApi.TypeScriptApi)
    const typeParser = yield* Nano.service(TypeParser.TypeParser)
    const tsUtils = yield* Nano.service(TypeScriptUtils.TypeScriptUtils)

    const nodeToVisit: Array<ts.Node> = []
    const appendNodeToVisit = (node: ts.Node) => {
      nodeToVisit.push(node)
      return undefined
    }
    ts.forEachChild(sourceFile, appendNodeToVisit)

    while (nodeToVisit.length > 0) {
      const node = nodeToVisit.shift()!

      if (ts.isIdentifier(node)) {
        // Handle Schema.Number
        const isSchemaNumber = yield* pipe(
          typeParser.isNodeReferenceToEffectSchemaModuleApi("Number")(node),
          Nano.option,
          Nano.map(Option.isSome)
        )

        if (isSchemaNumber) {
          report({
            location: node,
            messageText: "Schema.Number is unsafe. Use Schema.JsonNumber instead.",
            fixes: [{
              fixName: "schemaUnsafeTypes_replaceWithJsonNumber",
              description: "Replace with Schema.JsonNumber",
              apply: Nano.gen(function*() {
                const changeTracker = yield* Nano.service(TypeScriptApi.ChangeTracker)
                changeTracker.replaceNode(sourceFile, node, ts.factory.createIdentifier("JsonNumber"))
              })
            }]
          })
        } else {
          // Handle Schema.Date
          const isSchemaDate = yield* pipe(
            typeParser.isNodeReferenceToEffectSchemaModuleApi("Date")(node),
            Nano.option,
            Nano.map(Option.isSome)
          )

          if (isSchemaDate) {
            report({
              location: node,
              messageText: "Schema.Date is unsafe. Use Schema.Date.pipe(Schema.validDate()) instead.",
              fixes: [{
                fixName: "schemaUnsafeTypes_replaceWithValidDate",
                description: "Replace with Schema.Date.pipe(Schema.validDate())",
                apply: Nano.gen(function*() {
                  const changeTracker = yield* Nano.service(TypeScriptApi.ChangeTracker)

                  // Find Schema identifier or default to "Schema"
                  const schemaIdentifierName = tsUtils.findImportedModuleIdentifierByPackageAndNameOrBarrel(
                    sourceFile,
                    "effect",
                    "Schema"
                  ) || "Schema"

                  // Create Schema.validDate() call
                  const schemaValidDateCall = ts.factory.createCallExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier(schemaIdentifierName),
                      "validDate"
                    ),
                    undefined,
                    []
                  )

                  // Create node.pipe(Schema.validDate())
                  // node is 'Date' or 'Schema.Date'. It is an expression.
                  // Wait, node is Identifier. If it is part of PropertyAccess, we should replace the WHOLE property access if we want node.pipe?
                  // If node is "Date" in "Schema.Date".
                  // If we replace "Date" with "Date.pipe...", we get "Schema.Date.pipe...".
                  // BUT "Schema.Date.pipe..." is invalid if we replace "Date" (identifier) inside "Schema.Date" (PropertyAccess).
                  // "Schema.(Date.pipe...)" -> invalid syntax usually.
                  // We should replace the EXPRESSION that represents Schema.Date.

                  // If node is "Date" identifier.
                  // If parent is PropertyAccessExpression and node is name.
                  // Then the expression is node.parent.
                  // We should replace node.parent.

                  // If node is "Date" identifier (standalone).
                  // We replace node.

                  let nodeToReplace: ts.Node = node
                  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
                    nodeToReplace = node.parent
                  }

                  const newNode = ts.factory.createCallExpression(
                    ts.factory.createPropertyAccessExpression(
                      nodeToReplace as ts.Expression,
                      "pipe"
                    ),
                    undefined,
                    [schemaValidDateCall]
                  )

                  changeTracker.replaceNode(sourceFile, nodeToReplace, newNode)
                })
              }]
            })
          }
        }
      }

      ts.forEachChild(node, appendNodeToVisit)
    }
  })
})
