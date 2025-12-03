import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import type ts from "typescript"
import * as LSP from "../core/LSP.js"
import * as Nano from "../core/Nano.js"
import * as TypeParser from "../core/TypeParser.js"
import * as TypeScriptApi from "../core/TypeScriptApi.js"

const unsafeSchemas = {
  Number: {
    replacement: "JsonNumber",
    combinator: null,
    reason: "allows both NaN and +- Infinity"
  },
  Positive: {
    replacement: "JsonNumber",
    combinator: "positive",
    reason: "allows Infinity"
  },
  NonNegative: {
    replacement: "JsonNumber",
    combinator: "nonNegative",
    reason: "allows Infinity"
  },
  Negative: {
    replacement: "JsonNumber",
    combinator: "negative",
    reason: "allows -Infinity"
  },
  NonPositive: {
    replacement: "JsonNumber",
    combinator: "nonPositive",
    reason: "allows -Infinity"
  }
}

export const schemaUnsafeNumbers = LSP.createDiagnostic({
  name: "schemaUnsafeNumbers",
  code: 35,
  severity: "off",
  apply: Nano.fn("schemaUnsafeNumbers.apply")(function*(sourceFile, report) {
    const ts = yield* Nano.service(TypeScriptApi.TypeScriptApi)
    const typeParser = yield* Nano.service(TypeParser.TypeParser)

    const cloneExpression = (node: ts.Expression): ts.Expression => {
      if (ts.isIdentifier(node)) {
        return ts.factory.createIdentifier(ts.idText(node))
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
        return ts.factory.createPropertyAccessExpression(cloneExpression(node.expression), ts.idText(node.name))
      }
      return node
    }

    const nodeToVisit: Array<ts.Node> = []
    const appendNodeToVisit = (node: ts.Node) => {
      nodeToVisit.push(node)
      return undefined
    }
    ts.forEachChild(sourceFile, appendNodeToVisit)

    while (nodeToVisit.length > 0) {
      const node = nodeToVisit.shift()!

      if (ts.isPropertyAccessExpression(node)) {
        const name = node.name.text
        if (Object.prototype.hasOwnProperty.call(unsafeSchemas, name)) {
            const schemaInfo = unsafeSchemas[name as keyof typeof unsafeSchemas]

            const isUnsafeSchema = yield* pipe(
                typeParser.isNodeReferenceToEffectSchemaModuleApi(name)(node),
                Nano.orElse(() => Nano.void_)
            )

            if (isUnsafeSchema) {
                report({
                    location: node,
                    messageText: `Schema.${name} is unsafe because: ${schemaInfo.reason}.`,
                    fixes: [{
                        fixName: "schemaUnsafeNumbers_fix",
                        description: `Replace with Schema.${schemaInfo.replacement}${schemaInfo.combinator ? `.pipe(Schema.${schemaInfo.combinator}())` : ""}`,
                        apply: Nano.gen(function*() {
                            const changeTracker = yield* Nano.service(TypeScriptApi.ChangeTracker)

                            // Schema.JsonNumber
                            let replacementNode: ts.Expression = ts.factory.createPropertyAccessExpression(
                                cloneExpression(node.expression),
                                schemaInfo.replacement
                            )

                            if (schemaInfo.combinator) {
                                // .pipe(Schema.combinator())
                                replacementNode = ts.factory.createCallExpression(
                                    ts.factory.createPropertyAccessExpression(replacementNode, "pipe"),
                                    undefined,
                                    [
                                        ts.factory.createCallExpression(
                                            ts.factory.createPropertyAccessExpression(cloneExpression(node.expression), schemaInfo.combinator),
                                            undefined,
                                            []
                                        )
                                    ]
                                )
                            }

                            changeTracker.replaceNode(sourceFile, node, replacementNode)
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
