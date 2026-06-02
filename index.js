const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());



const serviceAccount = require("./kickbox-admin-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const uri = `mongodb+srv://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.gdfsllv.mongodb.net/?appName=Cluster0`;
console.log("USER:", `"${process.env.DB_USER}"`);

console.log("PASS:", `"${process.env.DB_PASS}"`);


const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });


const emailTransporter = nodemailer.createTransport(
    {
        service: 'gmail',
        auth: {
            user: process.env.KICK_EMAIL,
            pass: process.env.KICK_EMAIL_PASS
        }
    }
);

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        const db = client.db("kickboxbd");
        const counterCollection = db.collection("counters");
        const shoesCollection = db.collection("shoes");
        const ordersCollection = db.collection("orders");


        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            // verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
        }
        const generateSerial = () => {
          const now = new Date();
        
          const year = String(now.getFullYear()).slice(-2);
          const month = String(now.getMonth() + 1).padStart(2, "0");
          const day = String(now.getDate()).padStart(2, "0");
        
          const hour = String(now.getHours()).padStart(2, "0");
          const minute = String(now.getMinutes()).padStart(2, "0");
          const second = String(now.getSeconds()).padStart(2, "0");
        
          const milli = String(now.getMilliseconds()).padStart(3, "0");
        
          return `${year}${month}${day}${hour}${minute}${second}${milli}`;
        };

        // EMAIL ROUTE
        app.post('/send-confirmation-email', async (req, res) => {
            const { email, order } = req.body; // receive customer email & order details
            console.log(email, order)

            if (!email || !order) {
                return res.status(400).send({ result: 'Missing email or order data' });
            }

            const emailObj = {
                from: `"KickBox BD" <${process.env.KICK_EMAIL}>`,
                to: email,
                subject: "KickBox Order Received",
                html: `
                <h2>Thank you for your order!</h2>
                <p>We'll call you soon for confirmation.</p>
                <p><strong>Customer Name:</strong> ${order.customer.customerName}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Contact:</strong> ${order.customer.customerNumber}</p>
                <p><strong>Delivery Zone:</strong> ${order.customer.address}</p>
                <p><strong>District:</strong> ${order.customer.district}</p>
                <p><strong>Total Amount:</strong> ${order.totalAmount}৳</p>
                <h3>Products:</h3>
                <ul>
                  ${order.products.map(p => `<li>${p.name} - Size: ${p.size} - Color - ${p.color}  Qty: ${p.quantity} - Price: ${p.price}৳</li>`).join('')}
                </ul>
              `
            };

            try {
                const emailInfo = await emailTransporter.sendMail(emailObj);
                console.log('Email sent:', emailInfo.messageId);
                res.send({ result: 'success' });
            } catch (error) {
                console.log('Email failed:', error);
                res.status(500).send({ result: 'Email Failed' });
            }
        });
        app.get("/shoes/serial/:serial", async (req, res) => {
            const { serial } = req.params;
        
            const product = await shoesCollection.findOne({
                serialNumber: serial
            });
        
            if (!product) {
                return res.status(404).send({ message: "Product not found" });
            }
        
            res.send(product);
        });



        app.get("/orders", verifyFBToken, async (req, res) => {
          const { page = 1, limit = 8, search, date } = req.query;
        
          const query = {};
        
          // 🔍 Search
          if (search) {
            query["customer.customerNumber"] = {
              $regex: search,
              $options: "i",
            };
          }
        
          // 📅 Date filter (BD timezone)
          if (date) {
            const start = new Date(date + "T00:00:00+06:00");
            const end = new Date(date + "T23:59:59+06:00");
        
            query.createdAt = {
              $gte: start,
              $lte: end,
            };
          }
        
          const skip = (parseInt(page) - 1) * parseInt(limit);
        
          const orders = await ordersCollection
            .find(query)
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 })
            .toArray();
        
          const total = await ordersCollection.countDocuments(query);
        
          // 🔥 NEW: calculate total sales
          const allMatchingOrders = await ordersCollection.find(query).toArray();
        
          const totalSales = allMatchingOrders.reduce((sum, order) => {
            return sum + ( order.productsValue || 0);
          }, 0);
        
          res.send({
            orders,
            total,
            totalSales, // ✅ send this
            page: parseInt(page),
            limit: parseInt(limit),
          });
        });


        app.get("/orders/:id", verifyFBToken, async (req, res) => {
            const { id } = req.params;
            const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

            if (!order) {
                return res.status(404).send({ message: "Order not found" });
            }

            res.send(order);
        });


        app.get("/shoes", async (req, res) => {
          const {
              category,
              popular,
              discount,
              search,
              serial,
              sort,
              page = 1,
              limit = 8,
          } = req.query;
      
          const query = {};
          let sortQuery = {};
      
          // category
          if (category) query.category = category;
      
          // popular
          if (popular !== undefined) {
              query.popular = popular === "true";
          }
      
          // discount
          if (discount === "true") {
              query.discountPrice = { $gt: 0 };
          }
      
          // search by name
          if (search) {
              query.name = { $regex: search, $options: "i" };
          }
      
          // 🔥 search by serial number
          if (serial) {
              query.serialNumber = {
                  $regex: serial,
                  $options: "i",
              };
          }
      
          // sorting
          if (sort === "low-high") {
              sortQuery =
                  discount === "true"
                      ? { discountPrice: 1 }
                      : { price: 1 };
          }
      
          if (sort === "high-low") {
              sortQuery =
                  discount === "true"
                      ? { discountPrice: -1 }
                      : { price: -1 };
          }
      
          const skip = (page - 1) * parseInt(limit);
      
          const shoes = await shoesCollection
              .find(query)
              .sort(sortQuery)
              .skip(skip)
              .limit(parseInt(limit))
              .toArray();
      
          const total = await shoesCollection.countDocuments(query);
      
          res.send({
              shoes,
              total,
              page: parseInt(page),
              limit: parseInt(limit),
          });
      });
        app.get("/admin/items", verifyFBToken, async (req, res) => {
            try {
              const {
                category,
                popular,
                discount,
                search,
                sort, // low-high | high-low
                page = 1,
                limit = 8,
              } = req.query;
          
              const query = {};
              let sortQuery = {};
          
              const pageNum = parseInt(page);
              const limitNum = parseInt(limit);
          
              // 🎯 filters
              if (category) query.category = category;
          
              if (popular !== undefined) {
                query.popular = popular === "true";
              }
          
              if (discount === "true") {
                query.discountPrice = { $gt: 0 };
              }
          
              // 🔍 search
              if (search) {
                query.name = { $regex: search, $options: "i" };
              }
          
              // 💰 sorting
              if (sort === "low-high") {
                sortQuery = discount === "true"
                  ? { discountPrice: 1 }
                  : { price: 1 };
              }
          
              if (sort === "high-low") {
                sortQuery = discount === "true"
                  ? { discountPrice: -1 }
                  : { price: -1 };
              }
          
              const skip = (pageNum - 1) * limitNum;
          
              // 🔐 admin gets FULL data including costPrice
              const shoes = await shoesCollection
                .find(query)
                .sort(sortQuery)
                .skip(skip)
                .limit(limitNum)
                .toArray();
          
              const total = await shoesCollection.countDocuments(query);
          
              res.send({
                shoes,
                total,
                page: pageNum,
                limit: limitNum,
              });
          
            } catch (error) {
              console.error("Admin items fetch error:", error);
              res.status(500).send({ message: "Server error" });
            }
          });
        app.get("/admin/items/:id", verifyFBToken, async (req, res) => {
            try {
              const { id } = req.params;
          
              // 🛡️ validate ObjectId
              if (!ObjectId.isValid(id)) {
                return res.status(400).send({ message: "Invalid item ID" });
              }
          
              const query = { _id: new ObjectId(id) };
          
              // 🔐 admin gets full data including costPrice
              const item = await shoesCollection.findOne(query);
          
              if (!item) {
                return res.status(404).send({ message: "Item not found" });
              }
          
              res.send(item);
          
            } catch (error) {
              console.error("Admin item fetch error:", error);
              res.status(500).send({ message: "Server error" });
            }
          });  




        app.get("/shoes/:id", async (req, res) => {
            const { id } = req.params;

            const query = { _id: new ObjectId(id) };
            const result = await shoesCollection.findOne(query);
            res.send(result);
        })

        // app.post("/shoes", verifyFBToken, async (req, res) => {
        //     const product = req.body;
        //     // Insert product into MongoDB
        //     const result = await shoesCollection.insertOne(product);
        //     res.send(result);

        // });
         

        app.post("/shoes", verifyFBToken, async (req, res) => {
            try {
                const product = req.body;
        
                // 🔥 generate serial
                const serialNumber = await generateSerial();
        
                const newProduct = {
                    ...product,
                    serialNumber,
                    createdAt: new Date(),
                };
        
                const result = await shoesCollection.insertOne(newProduct);
        
                res.send({
                    success: true,
                    insertedId: result.insertedId,
                    serialNumber,
                });
        
            } catch (error) {
                console.error("Error adding product:", error);
                res.status(500).send({ message: "Failed to add product" });
            }
        });

        app.post("/orders", async (req, res) => {
            try {


                const orderData = req.body;
               

                const { customer, products, totalAmount,status } = orderData;
                console.log(status)
                if (
                    !customer ||
                    !customer.customerName ||
                   
                    !customer.customerNumber 
               
                ) {
                    return res.status(400).send({ message: "Customer information is incomplete" });
                }

                // Add metadata
                const newOrder = {
                    ...orderData,
                    status: status ? status : "pending" ,        // pending | confirmed | delivered
                    createdAt: new Date(),
                };
                console.log(newOrder)

                const result = await ordersCollection.insertOne(newOrder);

                res.status(201).send({
                    success: true,
                    insertedId: result.insertedId,
                    message: "Order placed successfully",
                });
            } catch (error) {
                console.error("Error creating order:", error);
                res.status(500).send({ success: false, message: "Failed to place order" });
            }
        });



        app.delete("/shoes/:id", verifyFBToken, async (req, res) => {
            const { id } = req.params;

            try {
                const query = { _id: new ObjectId(id) };
                const result = await shoesCollection.deleteOne(query);

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Shoe not found" });
                }

                res.send({
                    success: true,
                    message: "Shoe deleted successfully",
                    deletedId: id
                });
            } catch (error) {
                res.status(500).send({ message: "Invalid ID or server error" });
            }
        });


        app.delete("/orders/:id", verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;

                // Validate ObjectId
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid order ID" });
                }

                const result = await ordersCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Order not found" });
                }

                res.send({
                    success: true,
                    message: "Order deleted successfully",
                });
            } catch (error) {
                console.error("Error deleting order:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to delete order",
                });
            }
        });




        app.patch("/shoes/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const updateData = req.body;

                const result = await shoesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            ...updateData,
                            updatedAt: new Date(),
                        },
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Shoe not found" });
                }

                res.send({ success: true, message: "Shoe updated successfully" });
            } catch (error) {
                res.status(500).send({ message: "Update failed" });
            }
        });

        app.patch("/items/update/update-stock", async (req, res) => {
          try {
            const { products } = req.body;
        
            for (const item of products) {
              const product = await shoesCollection.findOne({
                _id: new ObjectId(item.shoeId),
              });
        
              if (!product) {
                return res.status(404).send({ message: "Product not found" });
              }
        
              const quantity = Number(item.quantity || 0);
              if (quantity <= 0) {
                return res.status(400).send({ message: "Invalid quantity" });
              }
        
              // =========================
              // 🧠 CASE 1: Variant exists (color/size based stock)
              // =========================
              if (product.variants && product.variants.length > 0) {
                const variantIndex = product.variants.findIndex(
                  (v) => v.color === item.color
                );
        
                if (variantIndex === -1) {
                  return res.status(400).send({
                    message: `Color not found: ${item.color}`,
                  });
                }
        
                const variant = product.variants[variantIndex];
        
                // If size exists → treat as size-based stock
                if (item.size && variant.sizes) {
                  const sizeStock = variant.sizes[item.size] || 0;
        
                  if (sizeStock < quantity) {
                    return res.status(400).send({
                      message: `Size ${item.size} out of stock for ${product.name}`,
                    });
                  }
        
                  await shoesCollection.updateOne(
                    {
                      _id: product._id,
                      "variants.color": item.color,
                    },
                    {
                      $inc: {
                        [`variants.$.sizes.${item.size}`]: -quantity,
                        totalStock: -quantity,
                      },
                      $set: { updatedAt: new Date() },
                    }
                  );
                } 
                // Otherwise color-based stock
                else {
                  if ((variant.stock || 0) < quantity) {
                    return res.status(400).send({
                      message: `Color ${item.color} out of stock for ${product.name}`,
                    });
                  }
        
                  await shoesCollection.updateOne(
                    {
                      _id: product._id,
                      "variants.color": item.color,
                    },
                    {
                      $inc: {
                        "variants.$.stock": -quantity,
                        totalStock: -quantity,
                      },
                      $set: { updatedAt: new Date() },
                    }
                  );
                }
              }
        
              // =========================
              // 🧾 CASE 2: Simple product (no variants)
              // =========================
              else {
                if ((product.totalStock || 0) < quantity) {
                  return res.status(400).send({
                    message: `Out of stock: ${product.name}`,
                  });
                }
        
                await shoesCollection.updateOne(
                  { _id: product._id },
                  {
                    $inc: { totalStock: -quantity },
                    $set: { updatedAt: new Date() },
                  }
                );
              }
            }
        
            res.send({ success: true, message: "Stock updated successfully" });
          } catch (error) {
            console.error("Stock update failed:", error);
            res.status(500).send({ message: "Stock update failed" });
          }
        });

        app.patch("/orders/:id/status", async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                const allowedStatuses = ["pending", "confirmed", "delivered"];

                if (!allowedStatuses.includes(status)) {
                    return res.status(400).send({ message: "Invalid order status" });
                }

                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status,
                            updatedAt: new Date(),
                        },
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Order not found" });
                }

                res.send({ success: true, message: "Order status updated" });
            } catch (error) {
                res.status(500).send({ success: false });
            }
        });



        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        //   await client.close();
    }
}
run().catch(console.dir);
app.get("/", (req, res) => {
    res.send("API is running...");
});


// app.get('/', (req, res) => {
//   res.send('Hello World!')
// })

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

